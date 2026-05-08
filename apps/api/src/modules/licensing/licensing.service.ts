import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Pool } from 'pg';
import { ADMIN_PG_POOL } from '../../common/database.module';
import { MODULE_CATALOG, isValidModuleCode, type ModuleDefinition } from './catalog';
import { defaultPermissionsFor } from './role-defaults';
import type { TenantRole } from '../../common/auth/roles.decorator';

export type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthly_price_xof: string;
  modules: string[];
  is_active: boolean;
};

export type TenantLicense = {
  module_code: string;
  enabled: boolean;
  source: 'plan' | 'addon' | 'manual';
  expires_at: string | null;
};

@Injectable()
export class LicensingService {
  private readonly log = new Logger(LicensingService.name);

  constructor(
    private readonly cls: ClsService,
    @Inject(ADMIN_PG_POOL) private readonly pool: Pool,
  ) {}

  // ---------------------------------------------------------------------------
  // Catalog & plans (public)
  // ---------------------------------------------------------------------------

  getCatalog(): ModuleDefinition[] {
    return MODULE_CATALOG;
  }

  async listPlans(): Promise<Plan[]> {
    const { rows } = await this.pool.query<Plan>(
      `SELECT id, code, name, description, monthly_price_xof::text, modules, is_active
         FROM plans WHERE is_active = TRUE ORDER BY monthly_price_xof ASC`,
    );
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Vue tenant : "qu'est-ce que je peux faire ?"
  // ---------------------------------------------------------------------------

  /** Modules effectivement actifs pour le tenant courant. */
  async listMyLicenses(): Promise<TenantLicense[]> {
    const tenantId = this.tenantId();
    const { rows } = await this.pool.query<TenantLicense>(
      `SELECT module_code, enabled, source, expires_at
         FROM tenant_licenses WHERE tenant_id = $1 ORDER BY module_code`,
      [tenantId],
    );
    return rows;
  }

  /**
   * Pour le frontend : pour CHAQUE module licencié, retourne les actions
   * autorisées au user courant (selon son rôle + overrides éventuels).
   * Permet à l'UI de cacher les boutons inaccessibles.
   */
  async getMyEffectivePermissions(): Promise<Array<{ module: string; actions: string[] }>> {
    const tenantId = this.tenantId();
    const role = this.cls.get<TenantRole>('role');
    if (!role) throw new BadRequestException('role manquant');

    const licenses = await this.pool.query<{ module_code: string }>(
      `SELECT module_code FROM tenant_licenses WHERE tenant_id = $1 AND enabled = TRUE`,
      [tenantId],
    );
    const overrides = await this.pool.query<{ module_code: string; actions: string[] }>(
      `SELECT module_code, actions FROM role_permissions
        WHERE tenant_id = $1 AND role = $2`,
      [tenantId, role],
    );
    const overrideMap = new Map(overrides.rows.map((r) => [r.module_code, r.actions]));

    return licenses.rows.map((l) => {
      const ov = overrideMap.get(l.module_code);
      const actions = ov ?? defaultPermissionsFor(role, l.module_code);
      return { module: l.module_code, actions };
    });
  }

  // ---------------------------------------------------------------------------
  // Admin (super-admin Matix) : assigner un plan, toggler un module
  // ---------------------------------------------------------------------------

  async assignPlan(tenantId: string, planCode: string): Promise<void> {
    const planRow = await this.pool.query<Plan>(
      `SELECT id, code, modules FROM plans WHERE code = $1 AND is_active = TRUE`,
      [planCode],
    );
    if (planRow.rows.length === 0) throw new NotFoundException(`Plan '${planCode}' introuvable`);
    const plan = planRow.rows[0];

    // Cas spécial Enterprise : si modules est vide, on prend tout le catalogue actif
    let moduleCodes = plan.modules;
    if (planCode === 'enterprise' && moduleCodes.length === 0) {
      // Enterprise = TOUT le catalogue (incluant 'coming-soon' qu'on active à la livraison)
      moduleCodes = MODULE_CATALOG.map((m) => m.code);
    }

    // Validation : tous les codes doivent exister dans le catalogue
    for (const c of moduleCodes) {
      if (!isValidModuleCode(c)) {
        throw new BadRequestException(`Module inconnu dans le plan: ${c}`);
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE tenants SET plan_id = $1 WHERE id = $2`, [plan.id, tenantId]);
      // Supprime les anciennes licences source='plan'
      await client.query(
        `DELETE FROM tenant_licenses WHERE tenant_id = $1 AND source = 'plan'`,
        [tenantId],
      );
      // Recrée à partir du plan
      for (const mc of moduleCodes) {
        await client.query(
          `INSERT INTO tenant_licenses (tenant_id, module_code, enabled, source)
           VALUES ($1, $2, TRUE, 'plan')
           ON CONFLICT (tenant_id, module_code) DO UPDATE
             SET enabled = TRUE, source = 'plan', updated_at = NOW()`,
          [tenantId, mc],
        );
      }
      await client.query('COMMIT');
      this.log.log(`Tenant ${tenantId} → plan ${planCode} (${moduleCodes.length} modules)`);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async toggleModule(tenantId: string, moduleCode: string, enabled: boolean): Promise<void> {
    if (!isValidModuleCode(moduleCode)) {
      throw new BadRequestException(`Module inconnu: ${moduleCode}`);
    }
    await this.pool.query(
      `INSERT INTO tenant_licenses (tenant_id, module_code, enabled, source)
       VALUES ($1, $2, $3, 'manual')
       ON CONFLICT (tenant_id, module_code) DO UPDATE
         SET enabled = EXCLUDED.enabled, source = 'manual', updated_at = NOW()`,
      [tenantId, moduleCode, enabled],
    );
  }

  async listLicensesForTenant(tenantId: string): Promise<TenantLicense[]> {
    const { rows } = await this.pool.query<TenantLicense>(
      `SELECT module_code, enabled, source, expires_at
         FROM tenant_licenses WHERE tenant_id = $1 ORDER BY module_code`,
      [tenantId],
    );
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private tenantId(): string {
    const id = this.cls.get<string>('tenantId');
    if (!id) throw new BadRequestException('tenant_id manquant');
    return id;
  }
}
