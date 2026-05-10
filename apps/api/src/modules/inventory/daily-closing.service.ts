import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Pool, PoolClient } from 'pg';
import { Inject } from '@nestjs/common';
import { ADMIN_PG_POOL } from '../../common/database.module';
import { getTenantPgClient } from '../../common/tenant-tx.interceptor';
import { MovementType } from './dto/record-movement.dto';

/**
 * DailyClosingService — gestion du "stock soir" par produit/PV/jour.
 *
 * Concepts :
 *  - "Stock theorique" pour (date, pos, produit) =
 *       SUM(stock_movements.quantity WHERE date <= closing_date)
 *    autrement dit : etat du stock que le systeme calcule a partir des
 *    mouvements (opening, sale, return, adjustment, transfer_in/out, closing).
 *
 *  - "Stock soir" effectif :
 *      * mode 'manuel' (defaut Boucherie) : l'utilisateur saisit. Pas
 *        d'auto-calcul. Le theorique est affiche pour comparaison.
 *      * mode 'automatique' : le systeme cree une entree avec source='auto',
 *        valeur = theorique. L'utilisateur peut overrider -> source='manual'.
 *
 *  - Cron de nuit (00:30 Africa/Dakar) : copie le stock soir J -> stock matin
 *    J+1 en posant un stock_movements type='opening' a J+1.
 */
@Injectable()
export class DailyClosingService {
  private readonly log = new Logger(DailyClosingService.name);

  constructor(
    private readonly cls: ClsService,
    @Inject(ADMIN_PG_POOL) private readonly adminPool: Pool,
  ) {}

  // ---------------------------------------------------------------------------
  // LECTURE — vue quotidienne par PV
  // ---------------------------------------------------------------------------

  /**
   * Vue quotidienne pour un PV : pour chaque produit du tenant, on retourne
   *   {stock_matin, ventes_qte, transferts_in, transferts_out,
   *    stock_theorique, closing (saisi/auto), mode, last_auto_at, source}
   *
   * Si pas de closing en base, le `closing` est null (rien saisi/calcule).
   */
  async getDailyView(closingDate: string, posId?: string): Promise<DailyClosingView[]> {
    const client = getTenantPgClient(this.cls);

    // Aggreger les mouvements par (product, pos) jusqu'a closing_date.
    // On fait 4 sous-totaux : opening, sales(-), transfer_in(+), transfer_out(-)
    // pour offrir une vue detaillee. Le theorique = somme algebrique.
    const params: unknown[] = [closingDate];
    let posFilter = '';
    if (posId) {
      params.push(posId);
      posFilter = `AND m.point_of_sale_id = $${params.length}`;
    }

    const sql = `
      WITH movements AS (
        SELECT
          m.product_id,
          m.point_of_sale_id,
          SUM(CASE WHEN m.movement_type = 'opening'
                    AND DATE(m.performed_at AT TIME ZONE 'UTC') = $1::date
                   THEN m.quantity ELSE 0 END)         AS stock_matin,
          SUM(CASE WHEN m.movement_type = 'sale'
                    AND DATE(m.performed_at AT TIME ZONE 'UTC') = $1::date
                   THEN -m.quantity ELSE 0 END)        AS ventes_qte,
          SUM(CASE WHEN m.movement_type = 'transfer_in'
                    AND DATE(m.performed_at AT TIME ZONE 'UTC') = $1::date
                   THEN m.quantity ELSE 0 END)         AS transferts_in,
          SUM(CASE WHEN m.movement_type = 'transfer_out'
                    AND DATE(m.performed_at AT TIME ZONE 'UTC') = $1::date
                   THEN -m.quantity ELSE 0 END)        AS transferts_out,
          SUM(CASE WHEN m.movement_type = 'adjustment'
                    AND DATE(m.performed_at AT TIME ZONE 'UTC') = $1::date
                   THEN m.quantity ELSE 0 END)         AS adjustments,
          SUM(CASE WHEN m.movement_type = 'return'
                    AND DATE(m.performed_at AT TIME ZONE 'UTC') = $1::date
                   THEN m.quantity ELSE 0 END)         AS retours
        FROM stock_movements m
        WHERE DATE(m.performed_at AT TIME ZONE 'UTC') = $1::date
          ${posFilter}
        GROUP BY m.product_id, m.point_of_sale_id
      )
      SELECT
        p.id                                     AS product_id,
        p.sku                                    AS product_sku,
        p.name                                   AS product_name,
        p.stock_mode                             AS stock_mode,
        p.category_id                            AS category_id,
        pc.name                                  AS category_name,
        pc.family                                AS category_family,
        pos.id                                   AS point_of_sale_id,
        pos.code                                 AS pos_code,
        pos.name                                 AS pos_name,
        COALESCE(mv.stock_matin, 0)::text        AS stock_matin,
        COALESCE(mv.ventes_qte, 0)::text         AS ventes_qte,
        COALESCE(mv.transferts_in, 0)::text      AS transferts_in,
        COALESCE(mv.transferts_out, 0)::text     AS transferts_out,
        COALESCE(mv.adjustments, 0)::text        AS adjustments,
        COALESCE(mv.retours, 0)::text            AS retours,
        sdc.id                                   AS closing_id,
        sdc.quantity::text                       AS closing_quantity,
        sdc.quantity_theorique::text             AS closing_theorique,
        sdc.source                               AS closing_source,
        sdc.last_auto_at                         AS closing_last_auto_at,
        sdc.set_at                               AS closing_set_at
      FROM products p
      CROSS JOIN points_of_sale pos
      LEFT JOIN product_categories pc ON pc.id = p.category_id
      LEFT JOIN movements mv
        ON mv.product_id = p.id AND mv.point_of_sale_id = pos.id
      LEFT JOIN stock_daily_closings sdc
        ON sdc.product_id = p.id
       AND sdc.point_of_sale_id = pos.id
       AND sdc.closing_date = $1::date
      WHERE p.deleted_at IS NULL
        AND pos.deleted_at IS NULL
        AND pos.is_active = TRUE
        ${posId ? `AND pos.id = $2` : ''}
      ORDER BY pos.name, p.name
    `;
    const { rows } = await client.query<RawDailyRow>(sql, params);

    return rows.map((r) => this._mapRowToView(r));
  }

  /**
   * Calcule le theorique a la volee SANS la table closings, juste depuis
   * stock_movements. Utilise par recomputeAuto() et avant chaque save manual
   * pour persister le theorique en parallele de la valeur saisie.
   *
   * Theorique = SUM(stock_movements.quantity) du jour pour (product, pos).
   * (Toutes les quantites sont signees : sale est deja negatif, transfer_out
   * negatif, etc.)
   */
  async computeTheorique(
    client: PoolClient,
    closingDate: string,
    posId: string,
    productId: string,
  ): Promise<number> {
    const { rows } = await client.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(quantity), 0)::text AS total
         FROM stock_movements
        WHERE point_of_sale_id = $1
          AND product_id = $2
          AND DATE(performed_at AT TIME ZONE 'UTC') = $3::date`,
      [posId, productId, closingDate],
    );
    return Number(rows[0]?.total ?? 0);
  }

  // ---------------------------------------------------------------------------
  // ECRITURE — saisie manuelle d'un stock soir
  // ---------------------------------------------------------------------------

  async setManual(
    closingDate: string,
    posId: string,
    productId: string,
    quantity: number,
  ): Promise<DailyClosingRecord> {
    if (quantity < 0) {
      throw new Error('quantity must be >= 0');
    }
    const client = getTenantPgClient(this.cls);
    const userId = this.cls.get<string>('userId') ?? null;
    const theorique = await this.computeTheorique(client, closingDate, posId, productId);

    const { rows } = await client.query<DailyClosingRecord>(
      `INSERT INTO stock_daily_closings
         (tenant_id, closing_date, point_of_sale_id, product_id,
          quantity, quantity_theorique, source, set_by)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, 'manual', $6)
       ON CONFLICT (tenant_id, closing_date, point_of_sale_id, product_id) DO UPDATE
         SET quantity = EXCLUDED.quantity,
             quantity_theorique = EXCLUDED.quantity_theorique,
             source = 'manual',
             set_by = EXCLUDED.set_by,
             set_at = NOW()
       RETURNING id, closing_date, point_of_sale_id, product_id,
                 quantity::text AS quantity,
                 quantity_theorique::text AS quantity_theorique,
                 source, last_auto_at, set_by, set_at`,
      [closingDate, posId, productId, quantity, theorique, userId],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // RECALCUL AUTO
  // ---------------------------------------------------------------------------

  /**
   * Pour chaque produit en mode 'automatique' du PV (ou de tous les PV si
   * posId omis), upsert une entree closings avec source='auto' et valeur =
   * theorique. Les produits deja en source='manual' NE sont PAS ecrases —
   * principe : l'utilisateur a la priorite.
   *
   * Idempotent. Retourne le nombre de lignes touchees.
   */
  async recomputeAuto(closingDate: string, posId?: string): Promise<{ updated: number }> {
    const client = getTenantPgClient(this.cls);
    const params: unknown[] = [closingDate];
    let posFilter = '';
    if (posId) {
      params.push(posId);
      posFilter = `AND pos.id = $${params.length}`;
    }

    // On upsert (date, pos, product) avec quantity = theorique pour les
    // produits stock_mode='automatique' uniquement, ET en bloquant l'override
    // sur ceux deja marques source='manual'.
    const { rowCount } = await client.query(
      `WITH movements AS (
         SELECT
           product_id,
           point_of_sale_id,
           SUM(quantity) AS theorique
         FROM stock_movements
         WHERE DATE(performed_at AT TIME ZONE 'UTC') = $1::date
         GROUP BY product_id, point_of_sale_id
       ),
       targets AS (
         SELECT
           p.id AS product_id,
           pos.id AS point_of_sale_id,
           COALESCE(mv.theorique, 0) AS theorique
         FROM products p
         CROSS JOIN points_of_sale pos
         LEFT JOIN movements mv
           ON mv.product_id = p.id AND mv.point_of_sale_id = pos.id
         WHERE p.deleted_at IS NULL
           AND p.stock_mode = 'automatique'
           AND pos.deleted_at IS NULL
           AND pos.is_active = TRUE
           ${posFilter}
       )
       INSERT INTO stock_daily_closings
         (tenant_id, closing_date, point_of_sale_id, product_id,
          quantity, quantity_theorique, source, last_auto_at, set_at)
       SELECT current_setting('app.tenant_id')::uuid, $1::date,
              t.point_of_sale_id, t.product_id,
              GREATEST(t.theorique, 0),
              t.theorique,
              'auto', NOW(), NOW()
         FROM targets t
       ON CONFLICT (tenant_id, closing_date, point_of_sale_id, product_id) DO UPDATE
         SET quantity = CASE
               WHEN stock_daily_closings.source = 'manual' THEN stock_daily_closings.quantity
               ELSE GREATEST(EXCLUDED.quantity_theorique, 0)
             END,
             quantity_theorique = EXCLUDED.quantity_theorique,
             last_auto_at = NOW(),
             updated_at = NOW()
         WHERE stock_daily_closings.source = 'auto'
            OR stock_daily_closings.source = 'manual'  -- on update last_auto_at toujours
      `,
      params,
    );

    return { updated: rowCount ?? 0 };
  }

  // ---------------------------------------------------------------------------
  // CRON DE NUIT — copie soir J -> matin J+1
  // ---------------------------------------------------------------------------

  /**
   * Pour chaque tenant, pour chaque ligne de stock_daily_closings du jour J :
   *  - INSERT un stock_movements type='opening' pour J+1 avec la quantite
   *    saisie/calculee comme stock matin du lendemain
   *  - Idempotent : si un opening pour J+1 existe deja avec
   *    reference_table='stock_daily_closings' + reference_id=closing.id,
   *    on skip. Sinon on insere.
   *
   * Tourne en BYPASSRLS (admin pool) car le scheduler scanne tous les tenants.
   * Tous les INSERT passent explicitement le tenant_id.
   */
  async runNightlyCarryOver(closingDate: string): Promise<{ created: number; tenants: number }> {
    const { rows: closings } = await this.adminPool.query<{
      id: string;
      tenant_id: string;
      point_of_sale_id: string;
      product_id: string;
      quantity: string;
    }>(
      `SELECT id, tenant_id, point_of_sale_id, product_id, quantity::text
         FROM stock_daily_closings
        WHERE closing_date = $1::date
          AND quantity > 0`,
      [closingDate],
    );

    if (closings.length === 0) {
      this.log.log(`Carry-over ${closingDate}: aucun closing a propager.`);
      return { created: 0, tenants: 0 };
    }

    const tenants = new Set<string>();
    let created = 0;

    // Date du lendemain en UTC midi (pour eviter les ambiguites DST)
    const next = new Date(closingDate + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    const nextDateIso = next.toISOString();

    for (const c of closings) {
      tenants.add(c.tenant_id);
      const qty = Number(c.quantity);
      if (qty <= 0) continue;

      // Idempotence : on cherche un opening existant ref_id = c.id
      const exists = await this.adminPool.query(
        `SELECT 1 FROM stock_movements
          WHERE tenant_id = $1
            AND product_id = $2
            AND point_of_sale_id = $3
            AND movement_type = 'opening'
            AND reference_table = 'stock_daily_closings'
            AND reference_id = $4
          LIMIT 1`,
        [c.tenant_id, c.product_id, c.point_of_sale_id, c.id],
      );
      if ((exists.rowCount ?? 0) > 0) continue;

      await this.adminPool.query(
        `INSERT INTO stock_movements
           (tenant_id, product_id, point_of_sale_id, movement_type, quantity,
            reference_table, reference_id, reason, performed_at)
         VALUES ($1, $2, $3, 'opening', $4,
                 'stock_daily_closings', $5,
                 'Report automatique stock soir -> stock matin', $6)`,
        [c.tenant_id, c.product_id, c.point_of_sale_id, qty, c.id, nextDateIso],
      );
      created++;
    }

    this.log.log(
      `Carry-over ${closingDate} -> ${nextDateIso.slice(0, 10)} : ${created} openings crees pour ${tenants.size} tenant(s).`,
    );
    return { created, tenants: tenants.size };
  }

  // ---------------------------------------------------------------------------
  // RECONCILIATION NOTES (Phase B helper, place ici car meme service)
  // ---------------------------------------------------------------------------

  async getNote(noteDate: string, posId: string): Promise<NoteRecord | null> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<NoteRecord>(
      `SELECT id, note_date, point_of_sale_id, body, set_by, created_at, updated_at
         FROM reconciliation_notes
        WHERE note_date = $1 AND point_of_sale_id = $2`,
      [noteDate, posId],
    );
    return rows[0] ?? null;
  }

  async setNote(noteDate: string, posId: string, body: string): Promise<NoteRecord> {
    const client = getTenantPgClient(this.cls);
    const userId = this.cls.get<string>('userId') ?? null;
    const { rows } = await client.query<NoteRecord>(
      `INSERT INTO reconciliation_notes
         (tenant_id, note_date, point_of_sale_id, body, set_by)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4)
       ON CONFLICT (tenant_id, note_date, point_of_sale_id) DO UPDATE
         SET body = EXCLUDED.body,
             set_by = EXCLUDED.set_by
       RETURNING id, note_date, point_of_sale_id, body, set_by, created_at, updated_at`,
      [noteDate, posId, body, userId],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // Mappers prives
  // ---------------------------------------------------------------------------

  private _mapRowToView(r: RawDailyRow): DailyClosingView {
    const stockMatin = Number(r.stock_matin);
    const ventes = Number(r.ventes_qte);
    const tIn = Number(r.transferts_in);
    const tOut = Number(r.transferts_out);
    const adj = Number(r.adjustments);
    const ret = Number(r.retours);
    const theorique = stockMatin - ventes + tIn - tOut + adj + ret;
    return {
      product: {
        id: r.product_id,
        sku: r.product_sku,
        name: r.product_name,
        stock_mode: r.stock_mode,
        category_id: r.category_id,
        category_name: r.category_name,
        category_family: r.category_family,
      },
      point_of_sale: {
        id: r.point_of_sale_id,
        code: r.pos_code,
        name: r.pos_name,
      },
      figures: {
        stock_matin: stockMatin,
        ventes_qte: ventes,
        transferts_in: tIn,
        transferts_out: tOut,
        adjustments: adj,
        retours: ret,
        stock_theorique: theorique,
      },
      closing: r.closing_id
        ? {
            id: r.closing_id,
            quantity: Number(r.closing_quantity ?? 0),
            quantity_theorique: Number(r.closing_theorique ?? 0),
            source: r.closing_source as 'auto' | 'manual',
            last_auto_at: r.closing_last_auto_at,
            set_at: r.closing_set_at ?? '',
          }
        : null,
    };
  }
}

// ============================================================================
// Types
// ============================================================================

type RawDailyRow = {
  product_id: string;
  product_sku: string;
  product_name: string;
  stock_mode: 'manuel' | 'automatique';
  category_id: string | null;
  category_name: string | null;
  category_family: string | null;
  point_of_sale_id: string;
  pos_code: string;
  pos_name: string;
  stock_matin: string;
  ventes_qte: string;
  transferts_in: string;
  transferts_out: string;
  adjustments: string;
  retours: string;
  closing_id: string | null;
  closing_quantity: string | null;
  closing_theorique: string | null;
  closing_source: string | null;
  closing_last_auto_at: string | null;
  closing_set_at: string | null;
};

export type DailyClosingView = {
  product: {
    id: string;
    sku: string;
    name: string;
    stock_mode: 'manuel' | 'automatique';
    category_id: string | null;
    category_name: string | null;
    category_family: string | null;
  };
  point_of_sale: {
    id: string;
    code: string;
    name: string;
  };
  figures: {
    stock_matin: number;
    ventes_qte: number;
    transferts_in: number;
    transferts_out: number;
    adjustments: number;
    retours: number;
    stock_theorique: number;
  };
  closing: {
    id: string;
    quantity: number;
    quantity_theorique: number;
    source: 'auto' | 'manual';
    last_auto_at: string | null;
    set_at: string;
  } | null;
};

export type DailyClosingRecord = {
  id: string;
  closing_date: string;
  point_of_sale_id: string;
  product_id: string;
  quantity: string;
  quantity_theorique: string;
  source: 'auto' | 'manual';
  last_auto_at: string | null;
  set_by: string | null;
  set_at: string;
};

export type NoteRecord = {
  id: string;
  note_date: string;
  point_of_sale_id: string;
  body: string;
  set_by: string | null;
  created_at: string;
  updated_at: string;
};

// Avoid "unused" lint
void NotFoundException;
void MovementType;
