import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Pool, PoolClient } from 'pg';
import { ADMIN_PG_POOL } from '../../common/database.module';
import { getTenantPgClient } from '../../common/tenant-tx.interceptor';
import { InventoryService } from '../inventory/inventory.service';
import { MovementType } from '../inventory/dto/record-movement.dto';
import {
  CreateSaleDto,
  CreateSaleItemDto,
  CreateSalePaymentDto,
} from './dto/create-sale.dto';

export type SaleStatus = 'draft' | 'posted' | 'voided';

export type Sale = {
  id: string;
  point_of_sale_id: string;
  customer_id: string | null;
  user_id: string;
  status: SaleStatus;
  subtotal: string;
  tax_total: string;
  total: string;
  paid_total: string;
  change_given: string;
  reference_number: string | null;
  notes: string | null;
  posted_at: string | null;
  voided_at: string | null;
  voided_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type SaleItem = {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  tax_rate: string;
  tax_amount: string;
  line_total: string;
};

export type SalePayment = {
  id: string;
  sale_id: string;
  method: string;
  amount: string;
  reference: string | null;
  status: string;
  received_at: string | null;
};

const SALE_COLS = `id, point_of_sale_id, customer_id, user_id, status, subtotal, tax_total, total,
  paid_total, change_given, reference_number, notes, posted_at, voided_at, voided_reason,
  created_at, updated_at`;

@Injectable()
export class SalesService {
  private readonly log = new Logger(SalesService.name);

  constructor(
    private readonly cls: ClsService,
    private readonly inventory: InventoryService,
    @Inject(ADMIN_PG_POOL) private readonly adminPool: Pool,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(opts: { status?: SaleStatus; limit?: number; offset?: number } = {}): Promise<Sale[]> {
    const client = getTenantPgClient(this.cls);
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    if (opts.status) {
      params.push(opts.status);
      where.push(`status = $${params.length}`);
    }
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    params.push(limit, offset);
    const sql = `SELECT ${SALE_COLS} FROM sales WHERE ${where.join(' AND ')}
                 ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const { rows } = await client.query<Sale>(sql, params);
    return rows;
  }

  async getById(
    id: string,
  ): Promise<Sale & { items: SaleItem[]; payments: SalePayment[] }> {
    const client = getTenantPgClient(this.cls);
    const saleRows = await client.query<Sale>(
      `SELECT ${SALE_COLS} FROM sales WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (saleRows.rows.length === 0) throw new NotFoundException('Vente introuvable');
    const sale = saleRows.rows[0];

    const items = await client.query<SaleItem>(
      `SELECT id, sale_id, product_id, quantity, unit_price, discount_amount, tax_rate, tax_amount, line_total
         FROM sale_items WHERE sale_id = $1 ORDER BY created_at`,
      [id],
    );
    const payments = await client.query<SalePayment>(
      `SELECT id, sale_id, method, amount, reference, status, received_at
         FROM sale_payments WHERE sale_id = $1 ORDER BY created_at`,
      [id],
    );
    return { ...sale, items: items.rows, payments: payments.rows };
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  /**
   * Crée une vente :
   *   - Résout les prix produits (si unit_price non fourni dans le DTO)
   *   - Calcule les line_total + subtotal + tax_total + total
   *   - Insère sale + sale_items + sale_payments dans la même tx
   *   - Si auto_post: décrémente le stock + alloue ref number
   */
  async create(
    dto: CreateSaleDto,
  ): Promise<Sale & { items: SaleItem[]; payments: SalePayment[] }> {
    const client = getTenantPgClient(this.cls);
    const userId = this.cls.get<string>('userId');
    if (!userId) throw new BadRequestException('user_id manquant dans le contexte');

    // 1. Résoudre les prix produits
    const productIds = dto.items.map((i) => i.product_id);
    const productPrices = await this.fetchProductPrices(client, productIds);

    // 2. Calculer les totaux
    const itemsCalc = dto.items.map((dtoItem) => this.calcItem(dtoItem, productPrices));
    const subtotal = itemsCalc.reduce((sum, i) => sum + (i.line_total - i.tax_amount), 0);
    const tax_total = itemsCalc.reduce((sum, i) => sum + i.tax_amount, 0);
    const total = subtotal + tax_total;

    // 3. Calculer paiements
    const payments = dto.payments ?? [];
    const paid_total = payments.reduce((sum, p) => sum + p.amount, 0);
    const change_given = Math.max(0, paid_total - total);

    if (dto.auto_post && paid_total < total) {
      throw new BadRequestException(
        `Auto-post impossible : payé ${paid_total} < total ${total}`,
      );
    }

    // 4. Vérifier point_of_sale + customer_id appartiennent au tenant (RLS s'en charge,
    //    mais on veut un message clair plutôt qu'une FK error)
    const posCheck = await client.query(`SELECT 1 FROM points_of_sale WHERE id = $1 AND deleted_at IS NULL`, [
      dto.point_of_sale_id,
    ]);
    if (posCheck.rowCount === 0) throw new BadRequestException('Point de vente introuvable');
    if (dto.customer_id) {
      const cCheck = await client.query(`SELECT 1 FROM customers WHERE id = $1 AND deleted_at IS NULL`, [
        dto.customer_id,
      ]);
      if (cCheck.rowCount === 0) throw new BadRequestException('Client introuvable');
    }

    // 5. INSERT sale
    const saleRow = await client.query<Sale>(
      `INSERT INTO sales (tenant_id, point_of_sale_id, customer_id, user_id, status,
                          subtotal, tax_total, total, paid_total, change_given, notes)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9)
       RETURNING ${SALE_COLS}`,
      [
        dto.point_of_sale_id,
        dto.customer_id ?? null,
        userId,
        subtotal.toFixed(2),
        tax_total.toFixed(2),
        total.toFixed(2),
        paid_total.toFixed(2),
        change_given.toFixed(2),
        dto.notes ?? null,
      ],
    );
    const sale = saleRow.rows[0];

    // 6. INSERT items
    const itemRows: SaleItem[] = [];
    for (const i of itemsCalc) {
      const r = await client.query<SaleItem>(
        `INSERT INTO sale_items (tenant_id, sale_id, product_id, quantity, unit_price, discount_amount, tax_rate, tax_amount, line_total)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, sale_id, product_id, quantity, unit_price, discount_amount, tax_rate, tax_amount, line_total`,
        [
          sale.id,
          i.product_id,
          i.quantity,
          i.unit_price.toFixed(2),
          i.discount_amount.toFixed(2),
          i.tax_rate.toFixed(4),
          i.tax_amount.toFixed(2),
          i.line_total.toFixed(2),
        ],
      );
      itemRows.push(r.rows[0]);
    }

    // 7. INSERT payments
    const paymentRows: SalePayment[] = [];
    for (const p of payments) {
      const r = await client.query<SalePayment>(
        `INSERT INTO sale_payments (tenant_id, sale_id, method, amount, reference, status, received_at, received_by)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, 'succeeded', NOW(), $5)
         RETURNING id, sale_id, method, amount, reference, status, received_at`,
        [sale.id, p.method, p.amount.toFixed(2), p.reference ?? null, userId],
      );
      paymentRows.push(r.rows[0]);
    }

    // 8. Auto-post if requested
    let finalSale = sale;
    if (dto.auto_post) {
      finalSale = await this.postInternal(client, sale.id, dto.point_of_sale_id, itemsCalc, userId);
    }

    return { ...finalSale, items: itemRows, payments: paymentRows };
  }

  // ---------------------------------------------------------------------------
  // Post (finalisation : décrément stock + allocation ref number)
  // ---------------------------------------------------------------------------

  async post(saleId: string): Promise<Sale> {
    const client = getTenantPgClient(this.cls);
    const userId = this.cls.get<string>('userId') ?? '';

    const saleRows = await client.query<Sale>(
      `SELECT ${SALE_COLS} FROM sales WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [saleId],
    );
    if (saleRows.rows.length === 0) throw new NotFoundException('Vente introuvable');
    const sale = saleRows.rows[0];
    if (sale.status !== 'draft') {
      throw new ConflictException(`Seules les ventes 'draft' peuvent être postées (statut actuel: ${sale.status})`);
    }
    if (Number(sale.paid_total) < Number(sale.total)) {
      throw new BadRequestException(`Payé ${sale.paid_total} < total ${sale.total}`);
    }

    const items = await client.query<{
      product_id: string;
      quantity: string;
      unit_price: string;
    }>(`SELECT product_id, quantity, unit_price FROM sale_items WHERE sale_id = $1`, [saleId]);

    const itemsCalc = items.rows.map((r) => ({
      product_id: r.product_id,
      quantity: Number(r.quantity),
      unit_price: Number(r.unit_price),
      discount_amount: 0,
      tax_rate: 0,
      tax_amount: 0,
      line_total: 0,
    }));

    return this.postInternal(client, saleId, sale.point_of_sale_id, itemsCalc, userId);
  }

  private async postInternal(
    client: PoolClient,
    saleId: string,
    posId: string,
    items: Array<{ product_id: string; quantity: number; unit_price: number }>,
    userId: string,
  ): Promise<Sale> {
    // 1. Allouer ref number (atomic)
    const refNumber = await this.allocateSaleRef(client);

    // 2. Décrémenter stock pour chaque item
    for (const i of items) {
      await this.inventory.recordMovementInternal(client, {
        product_id: i.product_id,
        point_of_sale_id: posId,
        movement_type: MovementType.SALE,
        quantity: -i.quantity,
        unit_cost: i.unit_price,
        reference_table: 'sales',
        reference_id: saleId,
        performed_by: userId,
      });
    }

    // 3. UPDATE sale: status=posted, posted_at, reference_number
    const r = await client.query<Sale>(
      `UPDATE sales SET status = 'posted', posted_at = NOW(), reference_number = $2, updated_at = NOW()
       WHERE id = $1 RETURNING ${SALE_COLS}`,
      [saleId, refNumber],
    );
    return r.rows[0];
  }

  // ---------------------------------------------------------------------------
  // Void (annulation après post)
  // ---------------------------------------------------------------------------

  async void(saleId: string, reason: string): Promise<Sale> {
    const client = getTenantPgClient(this.cls);
    const userId = this.cls.get<string>('userId') ?? '';

    const saleRows = await client.query<Sale>(
      `SELECT ${SALE_COLS} FROM sales WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [saleId],
    );
    if (saleRows.rows.length === 0) throw new NotFoundException('Vente introuvable');
    const sale = saleRows.rows[0];
    if (sale.status === 'voided') throw new ConflictException('Vente déjà annulée');

    // Si déjà postée : compenser le stock
    if (sale.status === 'posted') {
      const items = await client.query<{ product_id: string; quantity: string }>(
        `SELECT product_id, quantity FROM sale_items WHERE sale_id = $1`,
        [saleId],
      );
      for (const i of items.rows) {
        await this.inventory.recordMovementInternal(client, {
          product_id: i.product_id,
          point_of_sale_id: sale.point_of_sale_id,
          movement_type: MovementType.RETURN,
          quantity: Number(i.quantity), // positif
          reason: `Annulation vente ${sale.reference_number ?? sale.id}: ${reason}`,
          reference_table: 'sales',
          reference_id: saleId,
          performed_by: userId,
        });
      }
    }

    const r = await client.query<Sale>(
      `UPDATE sales SET status = 'voided', voided_at = NOW(), voided_reason = $2, updated_at = NOW()
       WHERE id = $1 RETURNING ${SALE_COLS}`,
      [saleId, reason],
    );
    return r.rows[0];
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async fetchProductPrices(
    client: PoolClient,
    productIds: string[],
  ): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const { rows } = await client.query<{ id: string; unit_price: string }>(
      `SELECT id, unit_price FROM products WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [productIds],
    );
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.id, Number(r.unit_price));
    for (const id of productIds) {
      if (!map.has(id)) throw new BadRequestException(`Produit ${id} introuvable`);
    }
    return map;
  }

  private calcItem(
    dto: CreateSaleItemDto,
    prices: Map<string, number>,
  ): {
    product_id: string;
    quantity: number;
    unit_price: number;
    discount_amount: number;
    tax_rate: number;
    tax_amount: number;
    line_total: number;
  } {
    const unit_price = dto.unit_price ?? prices.get(dto.product_id)!;
    const discount = dto.discount_amount ?? 0;
    const tax_rate = dto.tax_rate ?? 0;
    const gross = dto.quantity * unit_price - discount;
    if (gross < 0) throw new BadRequestException('Discount supérieur au montant ligne');
    const tax_amount = +(gross * tax_rate).toFixed(2);
    const line_total = +(gross + tax_amount).toFixed(2);
    return {
      product_id: dto.product_id,
      quantity: dto.quantity,
      unit_price,
      discount_amount: discount,
      tax_rate,
      tax_amount,
      line_total,
    };
  }

  private async allocateSaleRef(client: PoolClient): Promise<string> {
    // Allocate atomically — UPSERT puis +1
    const r = await client.query<{ current_value: string }>(
      `INSERT INTO document_sequences (tenant_id, sequence_type, current_value)
       VALUES (current_setting('app.tenant_id')::uuid, 'sale_ref', 1)
       ON CONFLICT (tenant_id, sequence_type) DO UPDATE
         SET current_value = document_sequences.current_value + 1
       RETURNING current_value`,
    );
    const seq = Number(r.rows[0].current_value);

    // Slug du tenant pour le préfixe (via admin pool — table tenants pas RLS-able depuis app)
    const tenantId = this.cls.get<string>('tenantId')!;
    const tenantRow = await this.adminPool.query<{ slug: string }>(
      `SELECT slug FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const slug = (tenantRow.rows[0]?.slug ?? 'tenant').toUpperCase();
    const year = new Date().getUTCFullYear();
    return `${slug}-${year}-${String(seq).padStart(6, '0')}`;
  }
}
