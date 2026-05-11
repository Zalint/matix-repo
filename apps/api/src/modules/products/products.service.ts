import { Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { getTenantPgClient } from '../../common/tenant-tx.interceptor';

export type StockMode = 'manuel' | 'automatique';

export type Product = {
  id: string;
  sku: string;
  name: string;
  unit_price: string; // numeric → string par défaut côté pg
  unit_price_gros: string | null; // override explicite du prix gros (NULL = calculé depuis le rabais tenant)
  gros_enabled: boolean;          // si false → pas de tarif gros (pas de toggle POS)
  effective_gros_price: string | null; // prix gros effectif (override OU unit_price - rebate). null si gros_enabled=false.
  category_id: string | null;
  stock_mode: StockMode;
  created_at: string;
  updated_at: string;
};

/**
 * Expression SQL qui calcule le prix gros effectif. À utiliser dans un SELECT
 * qui joint products avec tenants.
 *
 *   - gros_enabled = false → NULL (pas de toggle POS pour ce produit)
 *   - gros_enabled = true, unit_price_gros IS NOT NULL → override explicite
 *   - gros_enabled = true, unit_price_gros IS NULL → unit_price - tenant.default_gros_rebate_xof
 *     (jamais négatif — GREATEST(0, …))
 *
 * `p` est l'alias products, `t` celui de tenants.
 */
const EFFECTIVE_GROS_EXPR = `CASE
    WHEN p.gros_enabled = FALSE THEN NULL
    WHEN p.unit_price_gros IS NOT NULL THEN p.unit_price_gros
    ELSE GREATEST(p.unit_price - COALESCE(t.default_gros_rebate_xof, 0), 0)
  END`;

const SELECT_COLS = `
  p.id, p.sku, p.name, p.unit_price, p.unit_price_gros, p.gros_enabled,
  ${EFFECTIVE_GROS_EXPR} AS effective_gros_price,
  p.category_id, p.stock_mode, p.created_at, p.updated_at
`;

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
    const where: string[] = ['p.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (opts.category_id) {
      params.push(opts.category_id);
      where.push(`p.category_id = $${params.length}`);
    }
    const { rows } = await client.query<Product>(
      `SELECT ${SELECT_COLS}
         FROM products p
         LEFT JOIN tenants t ON t.id = p.tenant_id
        WHERE ${where.join(' AND ')}
        ORDER BY p.created_at DESC`,
      params,
    );
    return rows;
  }

  async getById(id: string): Promise<Product> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<Product>(
      `SELECT ${SELECT_COLS}
         FROM products p
         LEFT JOIN tenants t ON t.id = p.tenant_id
        WHERE p.id = $1 AND p.deleted_at IS NULL`,
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
    gros_enabled?: boolean;
    category_id?: string | null;
  }): Promise<Product> {
    const client = getTenantPgClient(this.cls);
    // Wrap INSERT dans une CTE pour pouvoir joindre tenants et calculer effective_gros_price.
    const { rows } = await client.query<Product>(
      `WITH inserted AS (
         INSERT INTO products
           (tenant_id, sku, name, unit_price, unit_price_gros, gros_enabled, category_id)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6)
         RETURNING *
       )
       SELECT ${SELECT_COLS}
         FROM inserted p
         LEFT JOIN tenants t ON t.id = p.tenant_id`,
      [
        input.sku,
        input.name,
        input.unit_price,
        input.unit_price_gros ?? null,
        // Si gros_enabled n'est pas explicitement passé, on l'active dès qu'un unit_price_gros est fourni (rétrocompat UI).
        input.gros_enabled ?? (input.unit_price_gros !== undefined && input.unit_price_gros !== null),
        input.category_id ?? null,
      ],
    );
    return rows[0];
  }

  async update(
    id: string,
    patch: Partial<{
      name: string;
      unit_price: number;
      unit_price_gros: number | null;
      gros_enabled: boolean;
      category_id: string | null;
    }>,
  ): Promise<Product> {
    const client = getTenantPgClient(this.cls);
    // category_id et unit_price_gros peuvent être explicitement mis à null → sentinel bool.
    const setCategory = Object.prototype.hasOwnProperty.call(patch, 'category_id');
    const setGros = Object.prototype.hasOwnProperty.call(patch, 'unit_price_gros');
    const setGrosEnabled = Object.prototype.hasOwnProperty.call(patch, 'gros_enabled');
    const { rows } = await client.query<Product>(
      `WITH updated AS (
         UPDATE products
            SET name             = COALESCE($2, name),
                unit_price       = COALESCE($3, unit_price),
                category_id      = CASE WHEN $5::bool THEN $4 ELSE category_id END,
                unit_price_gros  = CASE WHEN $7::bool THEN $6 ELSE unit_price_gros END,
                gros_enabled     = CASE WHEN $9::bool THEN $8 ELSE gros_enabled END,
                updated_at       = NOW()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *
       )
       SELECT ${SELECT_COLS}
         FROM updated p
         LEFT JOIN tenants t ON t.id = p.tenant_id`,
      [
        id,
        patch.name ?? null,
        patch.unit_price ?? null,
        setCategory ? patch.category_id ?? null : null,
        setCategory,
        setGros ? patch.unit_price_gros ?? null : null,
        setGros,
        setGrosEnabled ? patch.gros_enabled ?? false : false,
        setGrosEnabled,
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
      `WITH updated AS (
         UPDATE products
            SET stock_mode = $2,
                updated_at = NOW()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *
       )
       SELECT ${SELECT_COLS}
         FROM updated p
         LEFT JOIN tenants t ON t.id = p.tenant_id`,
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
