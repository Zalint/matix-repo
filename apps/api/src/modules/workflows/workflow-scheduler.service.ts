import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Pool } from 'pg';
import { ADMIN_PG_POOL } from '../../common/database.module';
import { N8nClientService } from './n8n-client.service';

type WorkflowRunTrigger = 'cron' | 'manual' | 'webhook';

type InstanceForFire = {
  id: string;
  tenant_id: string;
  template_id: string;
  template_code: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  custom_settings: Record<string, any>;
};

/**
 * Cron interne — declenche les workflows tenants selon `custom_settings.cron`.
 *
 * Phase 2 initiale : la boucle minute est STUBBED (un seul log periodique).
 * Le user activera la vraie logique quand les workflows seront uploades dans n8n.
 *
 * `fire(instanceId, triggered_by, user_id?)` est utilise par les triggers manuels
 * depuis tenant-workflows.controller — donc on garde l'implementation reelle de fire().
 *
 * Choix : on utilise ADMIN_PG_POOL (BYPASSRLS) ici car le scheduler tourne hors
 * d'un contexte HTTP/CLS — il scanne tous les tenants. Tous les INSERT/UPDATE
 * passent explicitement le tenant_id en parametre.
 */
@Injectable()
export class WorkflowSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WorkflowSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ADMIN_PG_POOL) private readonly pool: Pool,
    private readonly n8nClient: N8nClientService,
  ) {}

  onModuleInit(): void {
    // STUB : boucle minute desactivee tant que les workflows n8n ne sont pas uploades.
    // Quand le user sera pret, basculer WORKFLOWS_CRON_ENABLED=1 et la boucle s'allume.
    if (process.env.WORKFLOWS_CRON_ENABLED === '1') {
      this.log.log('Cron interne workflows ACTIF (60s tick).');
      this.timer = setInterval(() => {
        this.tickSafe().catch((e) =>
          this.log.error(`Tick scheduler erreur: ${(e as Error).message}`),
        );
      }, 60_000);
    } else {
      this.log.warn(
        'Cron interne workflows DESACTIVE (WORKFLOWS_CRON_ENABLED!=1) — TODO: real cron',
      );
    }
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Tick minute — protege par try/catch pour ne jamais crash le timer.
   */
  private async tickSafe(): Promise<void> {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const currentHHMM = `${hh}:${mm}`;

    const { rows } = await this.pool.query<InstanceForFire>(
      `SELECT twi.id, twi.tenant_id, twi.template_id, wt.code AS template_code,
              twi.custom_settings
         FROM tenant_workflow_instances twi
         JOIN workflow_templates wt ON wt.id = twi.template_id
        WHERE twi.enabled = TRUE AND wt.is_active = TRUE`,
    );

    for (const inst of rows) {
      const cronVal = inst.custom_settings?.cron;
      if (typeof cronVal !== 'string') continue;
      // Format attendu Phase 2 : 'HH:MM' (ex: '23:55').
      // TODO Phase 3 : support full cron expression (5-field).
      if (cronVal === currentHHMM) {
        this.log.log(
          `Cron match: tenant=${inst.tenant_id} template=${inst.template_code} → fire`,
        );
        // fire() ne throw pas — il logge ses erreurs en DB (workflow_runs).
        await this.fire(inst.id, 'cron').catch((e) =>
          this.log.error(`fire(${inst.id}) erreur: ${(e as Error).message}`),
        );
      }
    }
  }

  /**
   * Declenche l'execution d'une instance de workflow.
   *
   * Cycle :
   *  1. Charge l'instance + template (BYPASSRLS — appel cross-tenant possible)
   *  2. INSERT workflow_runs status='running'
   *  3. Build payload (tenant_id + custom_settings)
   *  4. Appelle n8nClient.triggerWebhook
   *  5. UPDATE workflow_runs status='success'/'error' + duree
   *  6. UPDATE tenant_workflow_instances last_run_*
   */
  async fire(
    instanceId: string,
    triggeredBy: WorkflowRunTrigger,
    triggeredByUser?: string,
  ): Promise<{ run_id: string; n8n_execution_id: string | null }> {
    const instRows = await this.pool.query<InstanceForFire>(
      `SELECT twi.id, twi.tenant_id, twi.template_id, wt.code AS template_code,
              twi.custom_settings
         FROM tenant_workflow_instances twi
         JOIN workflow_templates wt ON wt.id = twi.template_id
        WHERE twi.id = $1`,
      [instanceId],
    );
    if (instRows.rows.length === 0) {
      throw new Error(`Instance ${instanceId} introuvable`);
    }
    const inst = instRows.rows[0];

    // 1. INSERT run en status='running'
    const payloadSummary = {
      tenant_id: inst.tenant_id,
      settings_keys: Object.keys(inst.custom_settings ?? {}),
    };
    const runInsert = await this.pool.query<{ id: string }>(
      `INSERT INTO workflow_runs
         (tenant_id, instance_id, template_code, triggered_by, triggered_by_user,
          status, payload_summary)
       VALUES ($1, $2, $3, $4, $5, 'running', $6::jsonb)
       RETURNING id`,
      [
        inst.tenant_id,
        instanceId,
        inst.template_code,
        triggeredBy,
        triggeredByUser ?? null,
        JSON.stringify(payloadSummary),
      ],
    );
    const runId = runInsert.rows[0].id;

    const startedAt = Date.now();
    let n8nExecutionId: string | null = null;

    try {
      const payload = {
        tenant_id: inst.tenant_id,
        instance_id: instanceId,
        run_id: runId,
        triggered_by: triggeredBy,
        ...inst.custom_settings,
      };
      const { n8n_execution_id } = await this.n8nClient.triggerWebhook(
        inst.template_code,
        payload,
      );
      n8nExecutionId = n8n_execution_id;

      const durationMs = Date.now() - startedAt;
      await this.pool.query(
        `UPDATE workflow_runs
            SET status = 'success', finished_at = NOW(),
                duration_ms = $2, n8n_execution_id = $3
          WHERE id = $1`,
        [runId, durationMs, n8nExecutionId],
      );
      await this.pool.query(
        `UPDATE tenant_workflow_instances
            SET last_run_at = NOW(), last_run_status = 'success',
                last_run_error = NULL, updated_at = NOW()
          WHERE id = $1`,
        [instanceId],
      );

      this.log.log(
        `Run OK: tenant=${inst.tenant_id} template=${inst.template_code} run=${runId} (${durationMs}ms)`,
      );
      return { run_id: runId, n8n_execution_id: n8nExecutionId };
    } catch (e) {
      const errMsg = (e as Error).message ?? 'erreur inconnue';
      const durationMs = Date.now() - startedAt;
      await this.pool.query(
        `UPDATE workflow_runs
            SET status = 'error', finished_at = NOW(),
                duration_ms = $2, error_message = $3
          WHERE id = $1`,
        [runId, durationMs, errMsg],
      );
      await this.pool.query(
        `UPDATE tenant_workflow_instances
            SET last_run_at = NOW(), last_run_status = 'error',
                last_run_error = $2, updated_at = NOW()
          WHERE id = $1`,
        [instanceId, errMsg],
      );
      this.log.error(
        `Run ERREUR: tenant=${inst.tenant_id} template=${inst.template_code} run=${runId} : ${errMsg}`,
      );
      return { run_id: runId, n8n_execution_id: null };
    }
  }
}
