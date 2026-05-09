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
 * Phase 2 step 3 : la boucle minute est ACTIVE quand `WORKFLOWS_CRON_ENABLED=1`.
 * Format cron supporte : `HH:MM` strict (ex: '23:55'), interprete dans le fuseau
 * `WORKFLOWS_CRON_TZ` (default `Africa/Dakar`). Anti-double-fire en memoire.
 * TODO Phase 3 : full cron expression (5-field) + tenant.timezone par tenant.
 *
 * `fire(instanceId, triggered_by, user_id?)` est utilise par les triggers manuels
 * depuis tenant-workflows.service.triggerNow() — pas de circular dep car le
 * scheduler n'injecte PAS tenant-workflows.service.
 *
 * Choix : on utilise ADMIN_PG_POOL (BYPASSRLS) ici car le scheduler tourne hors
 * d'un contexte HTTP/CLS — il scanne tous les tenants. Tous les INSERT/UPDATE
 * passent explicitement le tenant_id en parametre.
 */
@Injectable()
export class WorkflowSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WorkflowSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;

  // Anti-double-fire : un meme instance ne doit etre tiree qu'une seule fois
  // par minute meme si tickSafe() est rappele a 60s de delta.
  // Cle = instanceId, valeur = 'YYYY-MM-DDTHH:MM' du dernier fire.
  private readonly lastFiredMinute = new Map<string, string>();

  // Fuseau horaire par defaut pour interpreter les cron 'HH:MM'.
  // Phase 2 : fixe a Africa/Dakar (UTC+0). Phase 3 : tenant.timezone.
  private readonly defaultTz = process.env.WORKFLOWS_CRON_TZ ?? 'Africa/Dakar';

  constructor(
    @Inject(ADMIN_PG_POOL) private readonly pool: Pool,
    private readonly n8nClient: N8nClientService,
  ) {}

  onModuleInit(): void {
    // Securite opt-in : le cron ne s'allume que si WORKFLOWS_CRON_ENABLED=1.
    // En staging/prod sans n8n configure ou en dev rapide, le cron reste OFF
    // et seul `triggerNow()` (manuel) marche.
    if (process.env.WORKFLOWS_CRON_ENABLED === '1') {
      this.log.log(
        `Cron interne workflows ACTIF (60s tick, tz=${this.defaultTz}).`,
      );
      this.timer = setInterval(() => {
        this.tickSafe().catch((e) =>
          this.log.error(`Tick scheduler erreur: ${(e as Error).message}`),
        );
      }, 60_000);
    } else {
      this.log.warn(
        'Cron interne workflows DESACTIVE (WORKFLOWS_CRON_ENABLED!=1) — declenchement manuel uniquement.',
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
   *
   * Logique :
   *  - Calcule l'heure courante (HH:MM) dans le fuseau `defaultTz`
   *  - Liste toutes les instances enabled
   *  - Match exact `custom_settings.cron === HH:MM` → fire
   *  - Anti-double-fire via Map<instanceId, lastMinuteFired>
   *
   * TODO Phase 3 : support full cron expression (5-field) + tenant.timezone.
   */
  private async tickSafe(): Promise<void> {
    const now = new Date();
    const currentHHMM = this.formatHHMM(now, this.defaultTz);
    const minuteKey = this.formatMinuteKey(now, this.defaultTz);

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
      // Format Phase 2 : 'HH:MM' (ex: '23:55'). Strict match.
      if (cronVal !== currentHHMM) continue;

      // Anti-double-fire : si on a deja fire cette instance pour cette minute,
      // on saute (peut arriver si 2 ticks tombent dans la meme minute).
      if (this.lastFiredMinute.get(inst.id) === minuteKey) {
        continue;
      }
      this.lastFiredMinute.set(inst.id, minuteKey);

      this.log.log(
        `Cron match: tenant=${inst.tenant_id} template=${inst.template_code} cron=${cronVal} → fire`,
      );
      // fire() ne throw pas — il logge ses erreurs en DB (workflow_runs).
      await this.fire(inst.id, 'cron').catch((e) =>
        this.log.error(`fire(${inst.id}) erreur: ${(e as Error).message}`),
      );
    }
  }

  /**
   * Retourne 'HH:MM' dans le fuseau donne. Utilise Intl.DateTimeFormat —
   * ca gere les transitions DST proprement (meme si Africa/Dakar n'en a pas).
   */
  private formatHHMM(d: Date, tz: string): string {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz,
    });
    // en-GB → "HH:MM" (24h)
    return fmt.format(d);
  }

  /**
   * Cle minute unique 'YYYY-MM-DDTHH:MM' dans le fuseau donne, pour
   * l'anti-double-fire.
   */
  private formatMinuteKey(d: Date, tz: string): string {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz,
    });
    // en-CA → "YYYY-MM-DD, HH:MM"
    return fmt.format(d).replace(', ', 'T');
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
      const result = await this.n8nClient.triggerWebhook(inst.template_code, payload);
      n8nExecutionId = result.n8nExecutionId;

      if (!result.success) {
        // L'appel webhook a echoue (n8n down, mode degrade, 4xx/5xx) — on
        // throw pour basculer sur la branche 'error' qui logge en DB.
        throw new Error(result.error ?? 'triggerWebhook a echoue');
      }

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
