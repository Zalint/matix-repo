import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { getTenantPgClient } from '../../common/tenant-tx.interceptor';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

export type Customer = {
  id: string;
  code: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  segment: string | null;
  credit_limit: string;       // numeric → string par défaut côté pg
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const COLS = `id, code, display_name, email, phone, address, segment, credit_limit, notes, created_at, updated_at`;

@Injectable()
export class CustomersService {
  constructor(private readonly cls: ClsService) {}

  async list(opts: { search?: string; segment?: string; limit?: number; offset?: number }): Promise<Customer[]> {
    const client = getTenantPgClient(this.cls);
    const params: unknown[] = [];
    const where: string[] = [`deleted_at IS NULL`];

    if (opts.search) {
      params.push(`%${opts.search}%`);
      where.push(`(display_name ILIKE $${params.length} OR code ILIKE $${params.length} OR phone ILIKE $${params.length})`);
    }
    if (opts.segment) {
      params.push(opts.segment);
      where.push(`segment = $${params.length}`);
    }

    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    params.push(limit, offset);

    const sql = `
      SELECT ${COLS} FROM customers
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const { rows } = await client.query<Customer>(sql, params);
    return rows;
  }

  async getById(id: string): Promise<Customer> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<Customer>(
      `SELECT ${COLS} FROM customers WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('Client introuvable');
    return rows[0];
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    const client = getTenantPgClient(this.cls);
    try {
      const { rows } = await client.query<Customer>(
        `INSERT INTO customers
           (tenant_id, code, display_name, email, phone, address, segment, credit_limit, notes)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, COALESCE($7, 0), $8)
         RETURNING ${COLS}`,
        [
          dto.code,
          dto.display_name,
          dto.email ?? null,
          dto.phone ?? null,
          dto.address ?? null,
          dto.segment ?? null,
          dto.credit_limit ?? null,
          dto.notes ?? null,
        ],
      );
      return rows[0];
    } catch (e: unknown) {
      // 23505 = unique violation Postgres → mappé en 409 (cf. ADR-0002 §11)
      if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === '23505') {
        throw new ConflictException(`Un client avec le code "${dto.code}" existe déjà`);
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<Customer>(
      `UPDATE customers SET
         display_name = COALESCE($2, display_name),
         email        = COALESCE($3, email),
         phone        = COALESCE($4, phone),
         address      = COALESCE($5, address),
         segment      = COALESCE($6, segment),
         credit_limit = COALESCE($7, credit_limit),
         notes        = COALESCE($8, notes),
         updated_at   = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${COLS}`,
      [
        id,
        dto.display_name ?? null,
        dto.email ?? null,
        dto.phone ?? null,
        dto.address ?? null,
        dto.segment ?? null,
        dto.credit_limit ?? null,
        dto.notes ?? null,
      ],
    );
    if (rows.length === 0) throw new NotFoundException('Client introuvable');
    return rows[0];
  }

  async softDelete(id: string): Promise<void> {
    const client = getTenantPgClient(this.cls);
    const { rowCount } = await client.query(
      `UPDATE customers SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (rowCount === 0) throw new NotFoundException('Client introuvable');
  }
}
