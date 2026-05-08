import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { ADMIN_PG_POOL } from '../../common/database.module';
import { KeycloakAdminService } from '../../common/keycloak/keycloak-admin.service';
import type { ProvisionTenantDto } from './dto/provision-tenant.dto';

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

export type ProvisionedTenant = {
  tenant: Tenant;
  owner: { user_id: string; email: string };
  message: string;
};

/**
 * Provisioning d'un nouveau tenant — Phase 0 minimal.
 *
 * Étapes :
 *  1. Crée la ligne `tenants` (status=trial) dans une tx admin (BYPASSRLS).
 *  2. Crée le user owner dans Keycloak avec attribut `tenant_ids[]` initialisé.
 *  3. Insère un `tenant_members` reliant Keycloak user_id ↔ tenant ↔ rôle owner.
 *  4. Seed minimal (Phase 0 : aucun ; Phase 1 : plan comptable SYSCOHADA, POS, etc.).
 *  5. Si Keycloak ou DB échoue après création tenant : rollback best-effort.
 *
 * Idempotence : pas garantie en Phase 0 — un retry après échec partiel peut nécessiter
 * un cleanup manuel. Phase 1 : pattern outbox + retry idempotent.
 */
@Injectable()
export class TenantsService {
  private readonly log = new Logger(TenantsService.name);

  constructor(
    @Inject(ADMIN_PG_POOL) private readonly pool: Pool,
    private readonly keycloak: KeycloakAdminService,
  ) {}

  async list(): Promise<Tenant[]> {
    const { rows } = await this.pool.query<Tenant>(
      `SELECT id, slug, legal_name, status, country_code, currency, locale, created_at
         FROM tenants WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    );
    return rows;
  }

  async provision(input: ProvisionTenantDto): Promise<ProvisionedTenant> {
    // Pre-check : slug déjà utilisé ?
    const exists = await this.pool.query<{ id: string }>(
      `SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL`,
      [input.slug],
    );
    if (exists.rows.length > 0) {
      throw new ConflictException(`Slug "${input.slug}" déjà utilisé`);
    }

    const client = await this.pool.connect();
    let kcUserId: string | null = null;

    try {
      await client.query('BEGIN');

      // 1. Créer le tenant
      const tenantRows = await client.query<Tenant>(
        `INSERT INTO tenants (slug, legal_name, status, country_code, currency, ninea, rc)
         VALUES ($1, $2, 'trial', COALESCE($3, 'SN'), COALESCE($4, 'XOF'), $5, $6)
         RETURNING id, slug, legal_name, status, country_code, currency, locale, created_at`,
        [
          input.slug,
          input.legal_name,
          input.country_code ?? null,
          input.currency ?? null,
          input.ninea ?? null,
          input.rc ?? null,
        ],
      );
      const tenant = tenantRows.rows[0];

      // 2. Créer le user dans Keycloak (hors tx, mais rollback DB si fail)
      const kcUser = await this.keycloak.createUser({
        email: input.owner.email,
        first_name: input.owner.first_name,
        last_name: input.owner.last_name,
        password: input.owner.password,
        tenant_id: tenant.id,
        roles: ['owner'],
        email_verified: true,
      });
      kcUserId = kcUser.user_id;

      // 3. Lier user ↔ tenant
      await client.query(
        `INSERT INTO tenant_members (tenant_id, user_id, email, role)
         VALUES ($1, $2, $3, 'owner')
         ON CONFLICT DO NOTHING`,
        [tenant.id, kcUser.user_id, input.owner.email],
      );

      // 4. Seed minimal (Phase 0 : aucun)
      await this.seedTenantDefaults(client, tenant.id);

      await client.query('COMMIT');
      this.log.log(`Tenant ${tenant.slug} (${tenant.id}) provisionné avec owner ${input.owner.email}`);

      return {
        tenant,
        owner: { user_id: kcUser.user_id, email: input.owner.email },
        message: `Tenant "${tenant.legal_name}" créé. L'owner peut se connecter avec ${input.owner.email}.`,
      };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      // Rollback Keycloak si user créé
      if (kcUserId) {
        try {
          await this.keycloak.deleteUser(kcUserId);
          this.log.warn(`Rolled back Keycloak user ${kcUserId} after failed tenant provision`);
        } catch (cleanupErr) {
          this.log.error(`Failed to cleanup Keycloak user ${kcUserId}: ${cleanupErr}`);
        }
      }
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Seed minimal Phase 0 — placeholder.
   * Phase 1 ajoutera : plan comptable SYSCOHADA, point de vente par défaut,
   * catégories produits standards, taux TVA, devises actives.
   */
  private async seedTenantDefaults(_client: PoolClient, _tenantId: string): Promise<void> {
    // No-op pour Phase 0 — les modules métier ne sont pas encore là.
  }
}
