import { Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { getTenantPgClient } from '../../common/tenant-tx.interceptor';

export type Product = {
  id: string;
  sku: string;
  name: string;
  unit_price: string; // numeric → string par défaut côté pg
  created_at: string;
  updated_at: string;
};

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

  async list(): Promise<Product[]> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<Product>(
      `SELECT id, sku, name, unit_price, created_at, updated_at
         FROM products
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC`,
    );
    return rows;
  }

  async getById(id: string): Promise<Product> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<Product>(
      `SELECT id, sku, name, unit_price, created_at, updated_at
         FROM products
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('Produit introuvable');
    return rows[0];
  }

  async create(input: { sku: string; name: string; unit_price: number }): Promise<Product> {
    const client = getTenantPgClient(this.cls);
    // tenant_id est rempli automatiquement par RLS WITH CHECK ?
    // NON — RLS filtre, mais ne SET pas. Il faut fournir tenant_id à l'INSERT.
    // On lit `app.tenant_id` du contexte de session pour le mettre.
    const { rows } = await client.query<Product>(
      `INSERT INTO products (tenant_id, sku, name, unit_price)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3)
       RETURNING id, sku, name, unit_price, created_at, updated_at`,
      [input.sku, input.name, input.unit_price],
    );
    return rows[0];
  }

  async update(id: string, patch: Partial<{ name: string; unit_price: number }>): Promise<Product> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<Product>(
      `UPDATE products
          SET name = COALESCE($2, name),
              unit_price = COALESCE($3, unit_price),
              updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id, sku, name, unit_price, created_at, updated_at`,
      [id, patch.name ?? null, patch.unit_price ?? null],
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
