import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PoolClient } from 'pg';
import { getTenantPgClient } from '../../common/tenant-tx.interceptor';
import { MovementType, RecordMovementDto } from './dto/record-movement.dto';

export type StockLevel = {
  id: string;
  product_id: string;
  point_of_sale_id: string;
  quantity_on_hand: string;
  quantity_reserved: string;
  updated_at: string;
};

export type StockMovement = {
  id: string;
  product_id: string;
  point_of_sale_id: string;
  movement_type: MovementType;
  quantity: string;
  unit_cost: string | null;
  reference_table: string | null;
  reference_id: string | null;
  reason: string | null;
  performed_by: string | null;
  performed_at: string;
};

const LEVEL_COLS = `id, product_id, point_of_sale_id, quantity_on_hand, quantity_reserved, updated_at`;
const MOVEMENT_COLS = `id, product_id, point_of_sale_id, movement_type, quantity, unit_cost, reference_table, reference_id, reason, performed_by, performed_at`;

@Injectable()
export class InventoryService {
  private readonly log = new Logger(InventoryService.name);

  constructor(private readonly cls: ClsService) {}

  // ---------------------------------------------------------------------------
  // Stock levels (cache)
  // ---------------------------------------------------------------------------

  async listLevels(opts: { product_id?: string; point_of_sale_id?: string } = {}): Promise<StockLevel[]> {
    const client = getTenantPgClient(this.cls);
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.product_id) {
      params.push(opts.product_id);
      where.push(`product_id = $${params.length}`);
    }
    if (opts.point_of_sale_id) {
      params.push(opts.point_of_sale_id);
      where.push(`point_of_sale_id = $${params.length}`);
    }
    const sql = `SELECT ${LEVEL_COLS} FROM stock_levels${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC`;
    const { rows } = await client.query<StockLevel>(sql, params);
    return rows;
  }

  async getLevel(productId: string, posId: string): Promise<StockLevel | null> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<StockLevel>(
      `SELECT ${LEVEL_COLS} FROM stock_levels WHERE product_id = $1 AND point_of_sale_id = $2`,
      [productId, posId],
    );
    return rows[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Stock movements (journal append-only)
  // ---------------------------------------------------------------------------

  async listMovements(opts: {
    product_id?: string;
    point_of_sale_id?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<StockMovement[]> {
    const client = getTenantPgClient(this.cls);
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.product_id) {
      params.push(opts.product_id);
      where.push(`product_id = $${params.length}`);
    }
    if (opts.point_of_sale_id) {
      params.push(opts.point_of_sale_id);
      where.push(`point_of_sale_id = $${params.length}`);
    }
    const limit = Math.min(opts.limit ?? 100, 500);
    const offset = opts.offset ?? 0;
    params.push(limit, offset);
    const sql = `
      SELECT ${MOVEMENT_COLS} FROM stock_movements
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY performed_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const { rows } = await client.query<StockMovement>(sql, params);
    return rows;
  }

  /**
   * Enregistre un mouvement public (depuis un endpoint user, ex: ajustement, opening stock).
   * Le trigger DB met à jour stock_levels automatiquement.
   *
   * Validation métier :
   *   - quantity ≠ 0
   *   - sale/transfer_out doivent être négatifs
   *   - opening/return/transfer_in doivent être positifs
   *   - adjustment et closing peuvent être les deux
   *   - le résultat ne doit pas rendre quantity_on_hand < 0 (sauf adjustment qui peut corriger)
   */
  async recordMovement(dto: RecordMovementDto): Promise<StockMovement> {
    const client = getTenantPgClient(this.cls);
    const userId = this.cls.get<string>('userId');

    this.validateMovementSign(dto);

    if (dto.movement_type !== MovementType.ADJUSTMENT) {
      const current = await this.getLevel(dto.product_id, dto.point_of_sale_id);
      const currentQty = current ? Number(current.quantity_on_hand) : 0;
      if (currentQty + dto.quantity < 0) {
        throw new BadRequestException(
          `Stock insuffisant : ${currentQty} en stock, mouvement de ${dto.quantity} demandé`,
        );
      }
    }

    return this.insertMovement(client, {
      ...dto,
      performed_by: userId ?? null,
    });
  }

  /**
   * API interne — appelée par d'autres services (Sales, Returns).
   * Le caller doit passer son propre PgClient (déjà dans la tx HTTP).
   * Pose reference_table/reference_id pour traçabilité.
   */
  async recordMovementInternal(
    client: PoolClient,
    input: RecordMovementDto & { reference_table?: string; reference_id?: string; performed_by?: string },
  ): Promise<StockMovement> {
    this.validateMovementSign(input);
    return this.insertMovement(client, input);
  }

  private validateMovementSign(dto: RecordMovementDto): void {
    if (dto.quantity === 0) {
      throw new BadRequestException('quantity must be non-zero');
    }
    const mustBeNegative = [MovementType.SALE, MovementType.TRANSFER_OUT];
    const mustBePositive = [MovementType.OPENING, MovementType.RETURN, MovementType.TRANSFER_IN];

    if (mustBeNegative.includes(dto.movement_type) && dto.quantity > 0) {
      throw new BadRequestException(`${dto.movement_type} doit être négatif`);
    }
    if (mustBePositive.includes(dto.movement_type) && dto.quantity < 0) {
      throw new BadRequestException(`${dto.movement_type} doit être positif`);
    }
  }

  private async insertMovement(
    client: PoolClient,
    input: RecordMovementDto & {
      reference_table?: string | null;
      reference_id?: string | null;
      performed_by?: string | null;
    },
  ): Promise<StockMovement> {
    const { rows } = await client.query<StockMovement>(
      `INSERT INTO stock_movements
         (tenant_id, product_id, point_of_sale_id, movement_type, quantity,
          unit_cost, reference_table, reference_id, reason, performed_by)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${MOVEMENT_COLS}`,
      [
        input.product_id,
        input.point_of_sale_id,
        input.movement_type,
        input.quantity,
        input.unit_cost ?? null,
        input.reference_table ?? null,
        input.reference_id ?? null,
        input.reason ?? null,
        input.performed_by ?? null,
      ],
    );
    return rows[0];
  }
}
