import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { getTenantPgClient } from '../../common/tenant-tx.interceptor';

export type ProductCategory = {
  id: string;
  code: string;
  name: string;
  family: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const COLS = `id, code, name, family, display_order, is_active, created_at, updated_at`;

@Injectable()
export class ProductCategoriesService {
  constructor(private readonly cls: ClsService) {}

  async list(opts: { activeOnly?: boolean } = {}): Promise<ProductCategory[]> {
    const client = getTenantPgClient(this.cls);
    const where = ['deleted_at IS NULL'];
    if (opts.activeOnly) where.push('is_active = TRUE');
    const { rows } = await client.query<ProductCategory>(
      `SELECT ${COLS} FROM product_categories
        WHERE ${where.join(' AND ')}
        ORDER BY family NULLS LAST, display_order, name`,
    );
    return rows;
  }

  async getById(id: string): Promise<ProductCategory> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<ProductCategory>(
      `SELECT ${COLS} FROM product_categories WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('Catégorie introuvable');
    return rows[0];
  }

  async create(input: { code: string; name: string; family?: string; display_order?: number }): Promise<ProductCategory> {
    const client = getTenantPgClient(this.cls);
    try {
      const { rows } = await client.query<ProductCategory>(
        `INSERT INTO product_categories (tenant_id, code, name, family, display_order)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, COALESCE($4, 0))
         RETURNING ${COLS}`,
        [input.code, input.name, input.family ?? null, input.display_order ?? null],
      );
      return rows[0];
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === '23505') {
        throw new ConflictException(`Code catégorie "${input.code}" déjà utilisé`);
      }
      throw e;
    }
  }

  async update(
    id: string,
    patch: Partial<{ name: string; family: string | null; display_order: number; is_active: boolean }>,
  ): Promise<ProductCategory> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<ProductCategory>(
      `UPDATE product_categories
          SET name          = COALESCE($2, name),
              family        = COALESCE($3, family),
              display_order = COALESCE($4, display_order),
              is_active     = COALESCE($5, is_active),
              updated_at    = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING ${COLS}`,
      [
        id,
        patch.name ?? null,
        patch.family ?? null,
        patch.display_order ?? null,
        patch.is_active ?? null,
      ],
    );
    if (rows.length === 0) throw new NotFoundException('Catégorie introuvable');
    return rows[0];
  }

  async softDelete(id: string): Promise<void> {
    const client = getTenantPgClient(this.cls);
    const { rowCount } = await client.query(
      `UPDATE product_categories SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (rowCount === 0) throw new NotFoundException('Catégorie introuvable');
  }
}
