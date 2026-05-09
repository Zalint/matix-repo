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
import { getTenantPgClient } from '../../common/tenant-tx.interceptor';
import { N8nClientService } from './n8n-client.service';
import { WorkflowSchedulerService } from './workflow-scheduler.service';
import type { WorkflowTemplate } from './workflow-templates.service';

export type TenantWorkflowInstance = {
  id: string;
  tenant_id: string;
  template_id: string;
  template_code: string;
  template_name: string;
  n8n_workflow_id: string | null;
  enabled: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  custom_settings: Record<string, any>;
  configured_by: string | null;
  configured_at: string | null;
  last_run_at: string | null;
  last_run_status: 'success' | 'error' | 'running' | null;
  last_run_error: string | null;
  created_at: string;
  updated_at: string;
};

const INSTANCE_COLS = `
  twi.id, twi.tenant_id, twi.template_id, wt.code AS template_code, wt.name AS template_name,
  twi.n8n_workflow_id, twi.enabled, twi.custom_settings, twi.configured_by, twi.configured_at,
  twi.last_run_at, twi.last_run_status, twi.last_run_error, twi.created_at, twi.updated_at
`;

/**
 * Service TENANT — operations RLS-scoped sur les instances de workflows.
 *
 * - listAvailableTemplates : utilise ADMIN_PG_POOL pour lire workflow_templates
 *   (table globale, sans tenant_id) puis filtre par modules licencies + restrictions.
 * - le reste : utilise getTenantPgClient(cls) — RLS auto-filtre par tenant.
 */
@Injectable()
export class TenantWorkflowsService {
  private readonly log = new Logger(TenantWorkflowsService.name);

  constructor(
    private readonly cls: ClsService,
    @Inject(ADMIN_PG_POOL) private readonly adminPool: Pool,
    private readonly n8nClient: N8nClientService,
    private readonly scheduler: WorkflowSchedulerService,
  ) {}

  // ---------------------------------------------------------------------------
  // Catalogue des templates disponibles pour le tenant courant
  // ---------------------------------------------------------------------------

  /**
   * Retourne les templates qu'un tenant peut activer :
   *  - is_active = TRUE
   *  - tous les `required_modules` sont actives dans tenant_licenses pour ce tenant
   *  - `restricted_to_tenants` vide OU contient ce tenant
   *
   * Utilise ADMIN_PG_POOL car workflow_templates est une table globale
   * (pas de tenant_id, pas de RLS).
   */
  async listAvailableTemplates(): Promise<WorkflowTemplate[]> {
    const tenantId = this.tenantId();

    // Modules effectivement actifs pour ce tenant
    const lic = await this.adminPool.query<{ module_code: string }>(
      `SELECT module_code FROM tenant_licenses
       WHERE tenant_id = $1 AND enabled = TRUE
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [tenantId],
    );
    const enabledModules = new Set(lic.rows.map((r) => r.module_code));

    const { rows } = await this.adminPool.query<WorkflowTemplate>(
      `SELECT id, code, name, description, n8n_definition, configurable_settings,
              required_modules, restricted_to_tenants, is_active, created_at, updated_at
         FROM workflow_templates
        WHERE is_active = TRUE
          AND (cardinality(restricted_to_tenants) = 0 OR $1 = ANY(restricted_to_tenants))
        ORDER BY code ASC`,
      [tenantId],
    );

    return rows.filter((tpl) =>
      tpl.required_modules.every((m) => enabledModules.has(m)),
    );
  }

  // ---------------------------------------------------------------------------
  // Instances du tenant courant
  // ---------------------------------------------------------------------------

  async listMyInstances(): Promise<TenantWorkflowInstance[]> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<TenantWorkflowInstance>(
      `SELECT ${INSTANCE_COLS}
         FROM tenant_workflow_instances twi
         JOIN workflow_templates wt ON wt.id = twi.template_id
        ORDER BY wt.code ASC`,
    );
    return rows;
  }

  async getInstance(instanceId: string): Promise<TenantWorkflowInstance> {
    const client = getTenantPgClient(this.cls);
    const { rows } = await client.query<TenantWorkflowInstance>(
      `SELECT ${INSTANCE_COLS}
         FROM tenant_workflow_instances twi
         JOIN workflow_templates wt ON wt.id = twi.template_id
        WHERE twi.id = $1`,
      [instanceId],
    );
    if (rows.length === 0) {
      throw new NotFoundException('Instance de workflow introuvable');
    }
    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // Activation
  // ---------------------------------------------------------------------------

  async activate(
    templateCode: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customSettings?: Record<string, any>,
  ): Promise<TenantWorkflowInstance> {
    const tenantId = this.tenantId();

    // Resolution du template (et verification disponibilite pour ce tenant)
    const available = await this.listAvailableTemplates();
    const template = available.find((t) => t.code === templateCode);
    if (!template) {
      throw new NotFoundException(
        `Template "${templateCode}" introuvable ou non disponible pour ce tenant`,
      );
    }

    const client = getTenantPgClient(this.cls);

    // Verifier qu'il n'y a pas deja une instance pour ce template
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM tenant_workflow_instances WHERE template_id = $1`,
      [template.id],
    );
    if (existing.rows.length > 0) {
      throw new ConflictException(
        `Une instance de "${templateCode}" existe deja pour ce tenant — utilisez l'endpoint settings`,
      );
    }

    // Pre-clone : on insere d'abord l'instance pour avoir un instanceId stable
    const settingsJson = JSON.stringify(customSettings ?? {});
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO tenant_workflow_instances
         (tenant_id, template_id, enabled, custom_settings, configured_by, configured_at)
       VALUES (current_setting('app.tenant_id')::uuid, $1, TRUE, $2::jsonb, $3, NOW())
       RETURNING id`,
      [template.id, settingsJson, this.userIdAsUuidOrNull()],
    );
    const instanceId = inserted.rows[0].id;

    // Clone du workflow dans n8n (stub Phase 2)
    let n8nWorkflowId: string;
    try {
      n8nWorkflowId = await this.n8nClient.cloneWorkflow(
        template.n8n_definition,
        tenantId,
        instanceId,
      );
      await this.n8nClient.updateWorkflowSettings(n8nWorkflowId, customSettings ?? {});
      await this.n8nClient.activateWorkflow(n8nWorkflowId, true);
    } catch (e) {
      this.log.error(
        `Echec clone n8n pour instance ${instanceId} (tenant ${tenantId}): ${(e as Error).message}`,
      );
      // L'instance reste en DB pour visibility ; l'admin pourra retry via updateSettings.
      throw e;
    }

    await client.query(
      `UPDATE tenant_workflow_instances SET n8n_workflow_id = $2, updated_at = NOW() WHERE id = $1`,
      [instanceId, n8nWorkflowId],
    );

    this.log.log(
      `Workflow active: tenant=${tenantId} template=${templateCode} instance=${instanceId}`,
    );

    return this.getInstance(instanceId);
  }

  // ---------------------------------------------------------------------------
  // Disable
  // ---------------------------------------------------------------------------

  async disable(instanceId: string): Promise<TenantWorkflowInstance> {
    const tenantId = this.tenantId();
    const client = getTenantPgClient(this.cls);

    const { rows } = await client.query<{ id: string; n8n_workflow_id: string | null }>(
      `UPDATE tenant_workflow_instances
          SET enabled = FALSE, updated_at = NOW()
        WHERE id = $1
        RETURNING id, n8n_workflow_id`,
      [instanceId],
    );
    if (rows.length === 0) {
      throw new NotFoundException('Instance de workflow introuvable');
    }

    if (rows[0].n8n_workflow_id) {
      try {
        await this.n8nClient.activateWorkflow(rows[0].n8n_workflow_id, false);
      } catch (e) {
        this.log.warn(
          `Disable n8n workflow ${rows[0].n8n_workflow_id} a echoue (continue quand meme): ${(e as Error).message}`,
        );
      }
    }

    this.log.log(`Workflow desactive: tenant=${tenantId} instance=${instanceId}`);
    return this.getInstance(instanceId);
  }

  // ---------------------------------------------------------------------------
  // Update settings
  // ---------------------------------------------------------------------------

  async updateSettings(
    instanceId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customSettings: Record<string, any>,
  ): Promise<TenantWorkflowInstance> {
    if (!customSettings || typeof customSettings !== 'object') {
      throw new BadRequestException('custom_settings doit etre un objet JSON');
    }
    const client = getTenantPgClient(this.cls);

    const { rows } = await client.query<{ id: string; n8n_workflow_id: string | null }>(
      `UPDATE tenant_workflow_instances
          SET custom_settings = $2::jsonb,
              configured_by = $3,
              configured_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, n8n_workflow_id`,
      [instanceId, JSON.stringify(customSettings), this.userIdAsUuidOrNull()],
    );
    if (rows.length === 0) {
      throw new NotFoundException('Instance de workflow introuvable');
    }

    if (rows[0].n8n_workflow_id) {
      await this.n8nClient.updateWorkflowSettings(rows[0].n8n_workflow_id, customSettings);
    }

    return this.getInstance(instanceId);
  }

  // ---------------------------------------------------------------------------
  // Trigger now (manuel)
  // ---------------------------------------------------------------------------

  async triggerNow(instanceId: string): Promise<{ run_id: string; n8n_execution_id: string | null }> {
    // Verifie que l'instance existe et appartient bien a ce tenant (RLS le garantit deja)
    await this.getInstance(instanceId);

    const userIdForAudit = this.userIdAsUuidOrNull() ?? undefined;
    return this.scheduler.fire(instanceId, 'manual', userIdForAudit);
  }

  // ---------------------------------------------------------------------------
  // Audit runs
  // ---------------------------------------------------------------------------

  async listRuns(instanceId?: string, limit = 50): Promise<unknown[]> {
    const client = getTenantPgClient(this.cls);
    const params: unknown[] = [];
    let where = '';
    if (instanceId) {
      params.push(instanceId);
      where = `WHERE instance_id = $1`;
    }
    params.push(Math.min(limit, 200));
    const { rows } = await client.query(
      `SELECT id, instance_id, template_code, triggered_by, triggered_by_user,
              started_at, finished_at, status, duration_ms, n8n_execution_id,
              error_message, payload_summary, output_summary
         FROM workflow_runs
         ${where}
         ORDER BY started_at DESC
         LIMIT $${params.length}`,
      params,
    );
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Helpers CLS
  // ---------------------------------------------------------------------------

  private tenantId(): string {
    const id = this.cls.get<string>('tenantId');
    if (!id) throw new BadRequestException('tenant_id manquant dans le contexte');
    return id;
  }

  /**
   * Retourne le user_id courant si c'est un UUID valide, sinon null.
   *
   * Cas 'system' : les appels machine (n8n via X-Service-Token) posent
   * userId='system' qui n'est pas un UUID — on retourne null pour ne pas
   * casser l'INSERT/UPDATE sur les colonnes UUID nullable (configured_by,
   * triggered_by_user).
   */
  private userIdAsUuidOrNull(): string | null {
    const id = this.cls.get<string>('userId');
    if (!id) return null;
    // UUID v4 format simple (regex). Evite d'importer uuid juste pour ca.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    return isUuid ? id : null;
  }
}
