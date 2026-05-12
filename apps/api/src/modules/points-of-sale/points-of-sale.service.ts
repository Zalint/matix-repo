import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { getTenantPgClient } from '../../common/tenant-tx.interceptor';
import type { CreatePointOfSaleDto } from './dto/create-pos.dto';
import type { UpdatePointOfSaleDto } from './dto/update-pos.dto';

export type PointOfSale = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const COLS = `id, code, name, address, phone, is_active, created_at, updated_at`;

@Injectable()
export class PointsOfSaleService {
  constructor(private readonly cls: ClsService) {}

  async list(opts: { active_only?: boolean } = {}): Promise<PointOfSale[]> {
    const client = getTenantPgClient(this.cls);
    const where = ['deleted_at IS NULL'];
    if (opts.active_only) where.push('is_active = TRUE');
    const { rows } = await client.query<PointOfSale>(
      `SELECT ${COLS} FROM points_of_sale
        WHERE ${where.join(' AND ')}
        ORDER BY name`,
    );
    return rows;
  }

  async getById(id: string): Promise<PointOfSale> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<PointOfSale>(
      `SELECT ${COLS} FROM points_of_sale WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('Point de vente introuvable');
    return rows[0];
  }

  async create(dto: CreatePointOfSaleDto): Promise<PointOfSale> {
    const client = getTenantPgClient(this.cls);
    try {
      const { rows } = await client.query<PointOfSale>(
        `INSERT INTO points_of_sale
           (tenant_id, code, name, address, phone, is_active)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, COALESCE($5, TRUE))
         RETURNING ${COLS}`,
        [dto.code, dto.name, dto.address ?? null, dto.phone ?? null, dto.is_active ?? null],
      );
      return rows[0];
    } catch (e: unknown) {
      throw this._normalizeUniqueViolation(e, dto.code, dto.name);
    }
  }

  async update(id: string, dto: UpdatePointOfSaleDto): Promise<PointOfSale> {
    const client = getTenantPgClient(this.cls);
    try {
      const { rows } = await client.query<PointOfSale>(
        `UPDATE points_of_sale SET
           name       = COALESCE($2, name),
           address    = COALESCE($3, address),
           phone      = COALESCE($4, phone),
           is_active  = COALESCE($5, is_active),
           updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING ${COLS}`,
        [id, dto.name ?? null, dto.address ?? null, dto.phone ?? null, dto.is_active ?? null],
      );
      if (rows.length === 0) throw new NotFoundException('Point de vente introuvable');
      return rows[0];
    } catch (e: unknown) {
      if (e instanceof NotFoundException) throw e;
      throw this._normalizeUniqueViolation(e, null, dto.name);
    }
  }

  /**
   * Convertit les erreurs Postgres UNIQUE en ConflictException avec un message
   * adapté à la contrainte qui a sauté. Deux constraints à surveiller :
   *   - UNIQUE(tenant_id, code) sur la table → "code déjà utilisé"
   *   - uq_points_of_sale_tenant_name_active (index partiel) → "nom déjà utilisé"
   */
  private _normalizeUniqueViolation(
    e: unknown,
    code: string | null,
    name: string | undefined,
  ): unknown {
    if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === '23505') {
      const constraint = (e as { constraint?: string }).constraint;
      if (constraint === 'uq_points_of_sale_tenant_name_active') {
        return new ConflictException(
          `Un point de vente nommé "${name ?? ''}" existe déjà pour ce tenant.`,
        );
      }
      // Par défaut, on suppose la contrainte sur le code
      return new ConflictException(
        code
          ? `Point de vente avec le code "${code}" existe déjà.`
          : 'Conflit d\'unicité sur le point de vente.',
      );
    }
    return e;
  }

  async softDelete(id: string): Promise<void> {
    const client = getTenantPgClient(this.cls);
    const { rowCount } = await client.query(
      `UPDATE points_of_sale SET deleted_at = NOW(), is_active = FALSE
         WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (rowCount === 0) throw new NotFoundException('Point de vente introuvable');
  }
}
