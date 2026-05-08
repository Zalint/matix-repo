import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { ADMIN_PG_POOL } from '../../common/database.module';

export type Tenant = {
  id: string;
  slug: string;
  legal_name: string;
  status: string;
  country_code: string;
  currency: string;
  locale: string;
  created_at: string;
};

/**
 * Service Tenants = opérations admin plateforme uniquement.
 * Utilise ADMIN_PG_POOL (BYPASSRLS) car par définition cross-tenant.
 *
 * À protéger par un AuthGuard "super-admin Matix" (Phase 1) — pour l'instant ouvert en dev.
 */
@Injectable()
export class TenantsService {
  constructor(@Inject(ADMIN_PG_POOL) private readonly pool: Pool) {}

  async list(): Promise<Tenant[]> {
    const { rows } = await this.pool.query<Tenant>(
      `SELECT id, slug, legal_name, status, country_code, currency, locale, created_at
         FROM tenants WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    );
    return rows;
  }

  async provision(input: { slug: string; legal_name: string }): Promise<Tenant> {
    // Phase 1 : créer aussi user Keycloak, tenant_member owner, seed (plan comptable, etc.)
    const { rows } = await this.pool.query<Tenant>(
      `INSERT INTO tenants (slug, legal_name, status)
       VALUES ($1, $2, 'trial')
       RETURNING id, slug, legal_name, status, country_code, currency, locale, created_at`,
      [input.slug, input.legal_name],
    );
    return rows[0];
  }
}
