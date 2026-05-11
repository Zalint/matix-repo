import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Pool } from 'pg';
import { ADMIN_PG_POOL } from '../../common/database.module';

export type TenantSettings = {
  tenant_id: string;
  default_gros_rebate_xof: number;
};

/**
 * Settings au niveau tenant (lecture/écriture).
 *
 * La table `tenants` n'a pas de RLS (table système), donc on passe par
 * l'admin pool en filtrant manuellement sur le tenant_id du CLS. C'est
 * le même pattern que `sales.service.ts::allocateSaleRef` qui lit le slug.
 *
 * Ce service expose seulement les colonnes "settings" — pas le legal_name,
 * status, etc. Pour ça il y a TenantsService (admin-only).
 */
@Injectable()
export class TenantSettingsService {
  constructor(
    @Inject(ADMIN_PG_POOL) private readonly pool: Pool,
    private readonly cls: ClsService,
  ) {}

  async getMine(): Promise<TenantSettings> {
    const tenantId = this.cls.get<string>('tenantId');
    if (!tenantId) throw new NotFoundException('Tenant courant non résolu');
    const { rows } = await this.pool.query<{
      id: string;
      default_gros_rebate_xof: string;
    }>(
      `SELECT id, default_gros_rebate_xof
         FROM tenants
        WHERE id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );
    if (rows.length === 0) throw new NotFoundException('Tenant introuvable');
    return {
      tenant_id: rows[0].id,
      default_gros_rebate_xof: Number(rows[0].default_gros_rebate_xof),
    };
  }

  async updateMine(patch: {
    default_gros_rebate_xof?: number;
  }): Promise<TenantSettings> {
    const tenantId = this.cls.get<string>('tenantId');
    if (!tenantId) throw new NotFoundException('Tenant courant non résolu');

    const setDefaultGros = Object.prototype.hasOwnProperty.call(
      patch,
      'default_gros_rebate_xof',
    );

    if (!setDefaultGros) return this.getMine();

    if (patch.default_gros_rebate_xof !== undefined && patch.default_gros_rebate_xof < 0) {
      throw new NotFoundException('default_gros_rebate_xof doit être >= 0');
    }

    await this.pool.query(
      `UPDATE tenants
          SET default_gros_rebate_xof = $2,
              updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL`,
      [tenantId, patch.default_gros_rebate_xof ?? 0],
    );
    return this.getMine();
  }
}
