import { Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { getTenantPgClient } from '../../common/tenant-tx.interceptor';

export type StockMode = 'manuel' | 'automatique';

export type Product = {
  id: string;
  sku: string;
  name: string;
  unit_price: string; // numeric → string par défaut côté pg
  unit_price_gros: string | null; // tarif gros optionnel
  category_id: string | null;
  stock_mode: StockMode;
  created_at: string;
  updated_at: string;
};

const COLS = `id, sku, name, unit_price, unit_price_gros, category_id, stock_mode, created_at, updated_at`;

/**
 * Service Products — POC du pattern multi-tenant RLS.
 *
 * Aucune méthode ci-dessous ne mentionne `tenant_id` dans ses queries SQL.
 * Le filtrage est appliqué par la policy RLS au niveau Postgres,
 * grâce au `SET LOCAL app.tenant_id` posé par TenantTxInterceptor.
 *
 * Si un développeur écrit `WHERE tenant_id = ...` ici, c'est un code smell à challenger en review.
 */
@Injectable()
export class ProductsService {
  constructor(private readonly cls: ClsService) {}

  async list(opts: { category_id?: string } = {}): Promise<Product[]> {
    const client = getTenantPgClient(this.cls);
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    if (opts.category_id) {
      params.push(opts.category_id);
      where.push(`category_id = $${params.length}`);
    }
    const { rows } = await client.query<Product>(
      `SELECT ${COLS}
         FROM products
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC`,
      params,
    );
    return rows;
  }

  async getById(id: string): Promise<Product> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<Product>(
      `SELECT ${COLS}
         FROM products
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('Produit introuvable');
    return rows[0];
  }

  async create(input: {
    sku: string;
    name: string;
    unit_price: number;
    unit_price_gros?: number | null;
    category_id?: string | null;
  }): Promise<Product> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<Product>(
      `INSERT INTO products (tenant_id, sku, name, unit_price, unit_price_gros, category_id)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5)
       RETURNING ${COLS}`,
      [input.sku, input.name, input.unit_price, input.unit_price_gros ?? null, input.category_id ?? null],
    );
    return rows[0];
  }

  async update(
    id: string,
    patch: Partial<{
      name: string;
      unit_price: number;
      unit_price_gros: number | null;
      category_id: string | null;
    }>,
  ): Promise<Product> {
    const client = getTenantPgClient(this.cls);
    // category_id et unit_price_gros peuvent être explicitement mis à null → sentinel bool.
    const setCategory = Object.prototype.hasOwnProperty.call(patch, 'category_id');
    const setGros = Object.prototype.hasOwnProperty.call(patch, 'unit_price_gros');
    const { rows } = await client.query<Product>(
      `UPDATE products
          SET name             = COALESCE($2, name),
              unit_price       = COALESCE($3, unit_price),
              category_id      = CASE WHEN $5::bool THEN $4 ELSE category_id END,
              unit_price_gros  = CASE WHEN $7::bool THEN $6 ELSE unit_price_gros END,
              updated_at       = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING ${COLS}`,
      [
        id,
        patch.name ?? null,
        patch.unit_price ?? null,
        setCategory ? patch.category_id ?? null : null,
        setCategory,
        setGros ? patch.unit_price_gros ?? null : null,
        setGros,
      ],
    );
    if (rows.length === 0) throw new NotFoundException('Produit introuvable');
    return rows[0];
  }

  /**
   * Bascule le mode de gestion du stock soir d'un produit.
   *  - 'manuel'      : l'utilisateur saisit le stock soir chaque jour (defaut Boucherie)
   *  - 'automatique' : le systeme calcule (defaut autres familles)
   */
  async setStockMode(id: string, mode: StockMode): Promise<Product> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<Product>(
      `UPDATE products
          SET stock_mode = $2,
              updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING ${COLS}`,
      [id, mode],
    );
    if (rows.length === 0) throw new NotFoundException('Produit introuvable');
    return rows[0];
  }

  async softDelete(id: string): Promise<void> {
    const client = getTenantPgClient(this.cls);
    const { rowCount } = await client.query(
      `UPDATE products SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (rowCount === 0) throw new NotFoundException('Produit introuvable');
  }
}
