import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { getTenantPgClient } from '../../common/tenant-tx.interceptor';
import { CreateCuttingDto, CuttingOutputDto } from './dto/cutting.dto';

/**
 * CuttingsService — primitive "découpe" sur le stock.
 *
 * Une découpe consomme un produit source et produit N produits cibles. La
 * chute est calculée explicitement (source − Σ sorties), pas saisie.
 *
 * Invariants :
 *   - source_quantity > 0
 *   - chaque output.quantity > 0
 *   - Σ outputs.quantity ≤ source_quantity (sinon BadRequest)
 *   - tous les products référencés existent et appartiennent au tenant courant
 *     (garanti par RLS sur la requête de vérification)
 *
 * Atomicité : tous les inserts (stock_cuttings, stock_cutting_outputs, et
 * stock_movements cutting_in/cutting_out) passent dans la même transaction
 * HTTP, via le client tenant fourni par getTenantPgClient. Si l'un échoue,
 * tout rollback grâce à TenantTxInterceptor.
 */
@Injectable()
export class CuttingsService {
  private readonly log = new Logger(CuttingsService.name);

  constructor(private readonly cls: ClsService) {}

  // ---------------------------------------------------------------------------
  // CREATE — opération principale, transactionnelle
  // ---------------------------------------------------------------------------

  async create(dto: CreateCuttingDto): Promise<CuttingDetail> {
    this._validateOutputs(dto);

    const client = getTenantPgClient(this.cls);
    const userId = this.cls.get<string>('userId') ?? null;

    const totalOutputs = dto.outputs.reduce((s, o) => s + o.quantity, 0);
    const waste = dto.source_quantity - totalOutputs;
    if (waste < 0) {
      throw new BadRequestException(
        `Somme des sorties (${totalOutputs}) supérieure à la source (${dto.source_quantity}). La chute ne peut pas être négative.`,
      );
    }
    const wastePct = dto.source_quantity > 0
      ? Number(((waste / dto.source_quantity) * 100).toFixed(2))
      : 0;

    // 1) Insère le header
    const { rows: headerRows } = await client.query<CuttingRow>(
      `INSERT INTO stock_cuttings
         (tenant_id, point_of_sale_id, performed_at,
          source_product_id, source_quantity,
          total_outputs, waste_quantity, waste_pct,
          performed_by, notes)
       VALUES (current_setting('app.tenant_id')::uuid, $1,
               COALESCE($2::timestamptz, NOW()),
               $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${CUTTING_COLS}`,
      [
        dto.point_of_sale_id,
        dto.performed_at ?? null,
        dto.source_product_id,
        dto.source_quantity,
        totalOutputs,
        waste,
        wastePct,
        userId,
        dto.notes ?? null,
      ],
    );
    const header = headerRows[0];

    // 2) Insère les lignes outputs + mouvements cutting_in (1 par output)
    //    en parallèle avec un coût réparti au prorata du poids si fourni.
    const sourceCost = dto.source_unit_cost ?? null;
    const outputs: CuttingOutputRow[] = [];
    for (const o of dto.outputs) {
      const unitCost = o.unit_cost ?? (sourceCost !== null
        ? Number(((sourceCost * dto.source_quantity) / totalOutputs).toFixed(2))
        : null);

      const { rows: outRows } = await client.query<CuttingOutputRow>(
        `INSERT INTO stock_cutting_outputs
           (tenant_id, cutting_id, product_id, quantity, unit_cost)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4)
         RETURNING ${OUTPUT_COLS}`,
        [header.id, o.product_id, o.quantity, unitCost],
      );
      outputs.push(outRows[0]);

      // Mouvement stock cutting_in (positif) sur le produit fini
      await client.query(
        `INSERT INTO stock_movements
           (tenant_id, product_id, point_of_sale_id, movement_type, quantity,
            unit_cost, reference_table, reference_id, reason,
            performed_by, performed_at)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, 'cutting_in', $3,
                 $4, 'stock_cuttings', $5, $6, $7, $8)`,
        [
          o.product_id,
          dto.point_of_sale_id,
          o.quantity,
          unitCost,
          header.id,
          `Découpe ${header.id.slice(0, 8)} — sortie`,
          userId,
          header.performed_at,
        ],
      );
    }

    // 3) Mouvement stock cutting_out (négatif) sur la source
    await client.query(
      `INSERT INTO stock_movements
         (tenant_id, product_id, point_of_sale_id, movement_type, quantity,
          unit_cost, reference_table, reference_id, reason,
          performed_by, performed_at)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2, 'cutting_out', $3,
               $4, 'stock_cuttings', $5, $6, $7, $8)`,
      [
        dto.source_product_id,
        dto.point_of_sale_id,
        -dto.source_quantity,
        sourceCost,
        header.id,
        `Découpe ${header.id.slice(0, 8)} — consommation source`,
        userId,
        header.performed_at,
      ],
    );

    this.log.log(
      `Découpe ${header.id} créée : source ${dto.source_quantity} → ${outputs.length} sorties (${totalOutputs}) + chute ${waste} (${wastePct} %).`,
    );
    return { ...this._mapHeader(header), outputs: outputs.map(this._mapOutput) };
  }

  // ---------------------------------------------------------------------------
  // READ
  // ---------------------------------------------------------------------------

  async list(opts: {
    date?: string;             // YYYY-MM-DD : seul le jour
    point_of_sale_id?: string;
    source_product_id?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<CuttingDetail[]> {
    const client = getTenantPgClient(this.cls);
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.date) {
      params.push(opts.date);
      where.push(`DATE(performed_at AT TIME ZONE 'UTC') = $${params.length}::date`);
    }
    if (opts.point_of_sale_id) {
      params.push(opts.point_of_sale_id);
      where.push(`point_of_sale_id = $${params.length}`);
    }
    if (opts.source_product_id) {
      params.push(opts.source_product_id);
      where.push(`source_product_id = $${params.length}`);
    }
    const limit = Math.min(opts.limit ?? 100, 500);
    const offset = opts.offset ?? 0;
    params.push(limit, offset);

    const { rows: headers } = await client.query<CuttingRow>(
      `SELECT ${CUTTING_COLS}
         FROM stock_cuttings
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY performed_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    if (headers.length === 0) return [];

    const ids = headers.map((h) => h.id);
    const { rows: allOutputs } = await client.query<CuttingOutputRow & { cutting_id: string }>(
      `SELECT cutting_id, ${OUTPUT_COLS}
         FROM stock_cutting_outputs
        WHERE cutting_id = ANY($1::uuid[])`,
      [ids],
    );
    const outputsByCutting = new Map<string, CuttingOutputRow[]>();
    for (const o of allOutputs) {
      const list = outputsByCutting.get(o.cutting_id) ?? [];
      list.push(o);
      outputsByCutting.set(o.cutting_id, list);
    }

    return headers.map((h) => ({
      ...this._mapHeader(h),
      outputs: (outputsByCutting.get(h.id) ?? []).map(this._mapOutput),
    }));
  }

  async getById(id: string): Promise<CuttingDetail> {
    const client = getTenantPgClient(this.cls);
    const { rows: headers } = await client.query<CuttingRow>(
      `SELECT ${CUTTING_COLS} FROM stock_cuttings WHERE id = $1`,
      [id],
    );
    if (headers.length === 0) throw new NotFoundException('Découpe introuvable');

    const { rows: outputs } = await client.query<CuttingOutputRow>(
      `SELECT ${OUTPUT_COLS} FROM stock_cutting_outputs WHERE cutting_id = $1 ORDER BY created_at ASC`,
      [id],
    );

    return { ...this._mapHeader(headers[0]), outputs: outputs.map(this._mapOutput) };
  }

  // ---------------------------------------------------------------------------
  // STATS — agrégat par produit source sur une fenêtre
  // ---------------------------------------------------------------------------

  async yieldStats(opts: { from: string; to: string; point_of_sale_id?: string }): Promise<YieldStat[]> {
    const client = getTenantPgClient(this.cls);
    const params: unknown[] = [opts.from, opts.to];
    let posFilter = '';
    if (opts.point_of_sale_id) {
      params.push(opts.point_of_sale_id);
      posFilter = `AND c.point_of_sale_id = $${params.length}`;
    }

    const { rows } = await client.query<RawYieldRow>(
      `SELECT
         c.source_product_id                                  AS source_product_id,
         p.sku                                                AS source_sku,
         p.name                                               AS source_name,
         COUNT(*)::int                                        AS cuttings_count,
         COALESCE(SUM(c.source_quantity), 0)::text            AS source_total,
         COALESCE(SUM(c.total_outputs), 0)::text              AS outputs_total,
         COALESCE(SUM(c.waste_quantity), 0)::text             AS waste_total,
         CASE WHEN SUM(c.source_quantity) > 0
              THEN ROUND((SUM(c.total_outputs) / SUM(c.source_quantity)) * 100, 2)
              ELSE 0 END                                      AS yield_pct
       FROM stock_cuttings c
       JOIN products p ON p.id = c.source_product_id
       WHERE DATE(c.performed_at AT TIME ZONE 'UTC') BETWEEN $1::date AND $2::date
         ${posFilter}
       GROUP BY c.source_product_id, p.sku, p.name
       ORDER BY SUM(c.source_quantity) DESC`,
      params,
    );

    return rows.map((r) => ({
      source_product_id: r.source_product_id,
      source_sku: r.source_sku,
      source_name: r.source_name,
      cuttings_count: r.cuttings_count,
      source_total: Number(r.source_total),
      outputs_total: Number(r.outputs_total),
      waste_total: Number(r.waste_total),
      yield_pct: Number(r.yield_pct),
    }));
  }

  // ---------------------------------------------------------------------------
  // Helpers privés
  // ---------------------------------------------------------------------------

  private _validateOutputs(dto: CreateCuttingDto): void {
    if (dto.outputs.length === 0) {
      throw new BadRequestException('Au moins une sortie est requise.');
    }
    const seen = new Set<string>();
    for (const o of dto.outputs) {
      if (seen.has(o.product_id)) {
        throw new BadRequestException(
          `Produit ${o.product_id} apparaît deux fois dans les sorties. Regroupez les quantités.`,
        );
      }
      seen.add(o.product_id);

      if (o.product_id === dto.source_product_id) {
        throw new BadRequestException(
          'Le produit source ne peut pas être aussi en sortie (utilisez une autre découpe si besoin de re-conditionnement).',
        );
      }
    }
  }

  private _mapHeader(r: CuttingRow): CuttingHeader {
    return {
      id: r.id,
      point_of_sale_id: r.point_of_sale_id,
      performed_at: r.performed_at,
      source_product_id: r.source_product_id,
      source_quantity: Number(r.source_quantity),
      total_outputs: Number(r.total_outputs),
      waste_quantity: Number(r.waste_quantity),
      waste_pct: Number(r.waste_pct),
      performed_by: r.performed_by,
      notes: r.notes,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  private _mapOutput = (r: CuttingOutputRow): CuttingOutput => ({
    id: r.id,
    cutting_id: r.cutting_id,
    product_id: r.product_id,
    quantity: Number(r.quantity),
    unit_cost: r.unit_cost !== null ? Number(r.unit_cost) : null,
    created_at: r.created_at,
  });
}

// ============================================================================
// SQL aliases / types
// ============================================================================

const CUTTING_COLS = `id, point_of_sale_id, performed_at,
  source_product_id, source_quantity::text, total_outputs::text,
  waste_quantity::text, waste_pct::text,
  performed_by, notes, created_at, updated_at`;

const OUTPUT_COLS = `id, cutting_id, product_id, quantity::text, unit_cost::text, created_at`;

type CuttingRow = {
  id: string;
  point_of_sale_id: string;
  performed_at: string;
  source_product_id: string;
  source_quantity: string;
  total_outputs: string;
  waste_quantity: string;
  waste_pct: string;
  performed_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type CuttingOutputRow = {
  id: string;
  cutting_id: string;
  product_id: string;
  quantity: string;
  unit_cost: string | null;
  created_at: string;
};

type RawYieldRow = {
  source_product_id: string;
  source_sku: string;
  source_name: string;
  cuttings_count: number;
  source_total: string;
  outputs_total: string;
  waste_total: string;
  yield_pct: string;
};

// ============================================================================
// Types exposés
// ============================================================================

export type CuttingHeader = {
  id: string;
  point_of_sale_id: string;
  performed_at: string;
  source_product_id: string;
  source_quantity: number;
  total_outputs: number;
  waste_quantity: number;
  waste_pct: number;
  performed_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CuttingOutput = {
  id: string;
  cutting_id: string;
  product_id: string;
  quantity: number;
  unit_cost: number | null;
  created_at: string;
};

export type CuttingDetail = CuttingHeader & {
  outputs: CuttingOutput[];
};

export type YieldStat = {
  source_product_id: string;
  source_sku: string;
  source_name: string;
  cuttings_count: number;
  source_total: number;
  outputs_total: number;
  waste_total: number;
  yield_pct: number;
};

// Re-export DTO type pour usage dans le controller
export type { CuttingOutputDto };
