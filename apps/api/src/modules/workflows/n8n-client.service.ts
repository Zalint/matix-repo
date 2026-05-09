import { Injectable, Logger } from '@nestjs/common';

/**
 * Wrapper autour de l'API HTTP n8n.
 *
 * Phase 2 initiale : toutes les methodes sont STUBBED — elles loggent et
 * retournent du dummy data. Quand le user aura uploade les workflows JSON
 * dans n8n et configure N8N_API_KEY, on remplacera les `// TODO real n8n call`
 * par de vrais `fetch()` vers `${N8N_URL}/api/v1/...`.
 *
 * Variables d'environnement attendues :
 *  - N8N_URL       (default: http://localhost:5678)
 *  - N8N_API_KEY   (secret, gere manuellement par l'admin Matix)
 */
@Injectable()
export class N8nClientService {
  private readonly log = new Logger(N8nClientService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.baseUrl = process.env.N8N_URL ?? 'http://localhost:5678';
    this.apiKey = process.env.N8N_API_KEY ?? '';
    if (!this.apiKey) {
      this.log.warn(
        'N8N_API_KEY non defini — toutes les methodes seront en mode stub.',
      );
    }
  }

  /**
   * Clone un workflow depuis une definition + tag tenant_id.
   * Retourne l'ID du nouveau workflow dans n8n.
   */
  async cloneWorkflow(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    templateDef: any,
    tenantId: string,
    instanceId: string,
  ): Promise<string> {
    this.log.log(
      `[STUB] cloneWorkflow tenant=${tenantId} instance=${instanceId} — TODO: real n8n POST /api/v1/workflows`,
    );
    void templateDef;
    // Dummy ID stable et tracable par instance pour faciliter le debug Phase 2.
    return `stub-n8n-wf-${instanceId}`;
  }

  /**
   * Met a jour les settings d'un workflow n8n existant (typiquement le cron + variables).
   */
  async updateWorkflowSettings(
    n8nWorkflowId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: Record<string, any>,
  ): Promise<void> {
    this.log.log(
      `[STUB] updateWorkflowSettings ${n8nWorkflowId} settings=${JSON.stringify(settings)} — TODO: real n8n PATCH /api/v1/workflows/:id`,
    );
  }

  /**
   * Active ou desactive un workflow dans n8n.
   */
  async activateWorkflow(n8nWorkflowId: string, active: boolean): Promise<void> {
    this.log.log(
      `[STUB] activateWorkflow ${n8nWorkflowId} active=${active} — TODO: real n8n POST /api/v1/workflows/:id/(activate|deactivate)`,
    );
  }

  /**
   * Declenche un workflow via son webhook (POST). Retourne l'ID d'execution n8n.
   */
  async triggerWebhook(
    templateCode: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: Record<string, any>,
  ): Promise<{ n8n_execution_id: string }> {
    this.log.log(
      `[STUB] triggerWebhook ${templateCode} — TODO: real n8n POST /webhook/${templateCode}`,
    );
    void payload;
    return {
      n8n_execution_id: `stub-exec-${Date.now()}`,
    };
  }

  /**
   * Recupere le statut d'une execution n8n.
   */
  async getExecution(
    n8nExecutionId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ id: string; status: string; data?: any }> {
    this.log.log(
      `[STUB] getExecution ${n8nExecutionId} — TODO: real n8n GET /api/v1/executions/:id`,
    );
    return { id: n8nExecutionId, status: 'success' };
  }
}
