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
      if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === '23505') {
        throw new ConflictException(`Point de vente avec le code "${dto.code}" existe déjà`);
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdatePointOfSaleDto): Promise<PointOfSale> {
    const client = getTenantPgClient(this.cls);
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
