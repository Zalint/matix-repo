import { Injectable, Logger } from '@nestjs/common';

/**
 * Wrapper autour de l'API HTTP n8n.
 *
 * Architecture cible Phase 2 :
 *  - API Matix tourne en natif (Node) sur :3001 (host)
 *  - n8n tourne en Docker sur :5678 (host)
 *  - Donc Matix → n8n : http://localhost:5678
 *  - Et n8n → Matix : http://host.docker.internal:3001 (depuis le conteneur)
 *
 * Variables d'environnement attendues :
 *  - N8N_URL       (default: http://localhost:5678)
 *  - N8N_API_KEY   (secret, genere via n8n UI : Settings → n8n API)
 *
 * Mode degrade : si N8N_API_KEY est vide, toutes les methodes loggent un
 * warning et retournent null/false sans throw — l'app demarre quand meme
 * (utile en dev quand n8n n'est pas configure).
 *
 * Headers auth : `X-N8N-API-KEY: <token>`, `Content-Type: application/json`.
 */
@Injectable()
export class N8nClientService {
  private readonly log = new Logger(N8nClientService.name);
  private readonly n8nUrl = process.env.N8N_URL ?? 'http://localhost:5678';
  private readonly apiKey = process.env.N8N_API_KEY ?? '';

  constructor() {
    if (!this.apiKey) {
      this.log.warn(
        'N8N_API_KEY non defini — N8nClientService en mode degrade : toutes les methodes retournent null/false sans appeler n8n.',
      );
    } else {
      this.log.log(`N8nClientService initialise (n8nUrl=${this.n8nUrl}).`);
    }
  }

  /** Headers communs pour les calls /api/v1/* (avec auth). */
  private apiHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-N8N-API-KEY': this.apiKey,
    };
  }

  /** Vrai ssi le mode degrade est actif (pas d'apiKey). */
  private degraded(): boolean {
    return this.apiKey === '';
  }

  /**
   * Clone un workflow depuis une definition + tag tenant_id/instance_id.
   * Retourne l'ID du nouveau workflow dans n8n, ou null si echec.
   *
   * Note : n8n n'expose pas les `tags` via POST direct sur /workflows ;
   * on encode la tracabilite dans le name `[tenant=... inst=...]`.
   */
  async cloneWorkflow(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    templateDef: any,
    tenantId: string,
    instanceId: string,
  ): Promise<string | null> {
    if (this.degraded()) {
      this.log.warn(
        `cloneWorkflow ignore (mode degrade) tenant=${tenantId} instance=${instanceId}`,
      );
      return null;
    }
    if (!templateDef || typeof templateDef !== 'object') {
      this.log.error(
        `cloneWorkflow: templateDef invalide (tenant=${tenantId} instance=${instanceId})`,
      );
      return null;
    }

    const baseName: string =
      typeof templateDef.name === 'string' && templateDef.name.length > 0
        ? templateDef.name
        : 'Matix workflow';
    const cloned = {
      name: `${baseName} [tenant=${tenantId.slice(0, 8)} inst=${instanceId.slice(0, 8)}]`,
      nodes: templateDef.nodes ?? [],
      connections: templateDef.connections ?? {},
      settings: templateDef.settings ?? {},
    };

    try {
      const res = await fetch(`${this.n8nUrl}/api/v1/workflows`, {
        method: 'POST',
        headers: this.apiHeaders(),
        body: JSON.stringify(cloned),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.log.error(
          `cloneWorkflow KO (${res.status}) tenant=${tenantId} instance=${instanceId} : ${text}`,
        );
        return null;
      }
      const data = (await res.json()) as { id?: string };
      if (!data.id) {
        this.log.error(`cloneWorkflow KO : reponse n8n sans id (${JSON.stringify(data)})`);
        return null;
      }
      this.log.log(
        `cloneWorkflow OK n8n_id=${data.id} tenant=${tenantId} instance=${instanceId}`,
      );
      return data.id;
    } catch (e) {
      this.log.error(
        `cloneWorkflow erreur reseau tenant=${tenantId} instance=${instanceId} : ${(e as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Met a jour les meta (name, settings) d'un workflow n8n existant.
   * On ne touche pas a la definition (nodes/connections) — seuls les
   * meta merge-ables passent ici.
   */
  async updateWorkflowSettings(
    n8nWorkflowId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: Record<string, any>,
  ): Promise<boolean> {
    if (this.degraded()) {
      this.log.warn(`updateWorkflowSettings ignore (mode degrade) wf=${n8nWorkflowId}`);
      return false;
    }
    try {
      const res = await fetch(`${this.n8nUrl}/api/v1/workflows/${n8nWorkflowId}`, {
        method: 'PATCH',
        headers: this.apiHeaders(),
        body: JSON.stringify(settings ?? {}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.log.error(
          `updateWorkflowSettings KO (${res.status}) wf=${n8nWorkflowId} : ${text}`,
        );
        return false;
      }
      return true;
    } catch (e) {
      this.log.error(
        `updateWorkflowSettings erreur reseau wf=${n8nWorkflowId} : ${(e as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Active ou desactive un workflow dans n8n.
   * Retourne true si l'API a accepte, false sinon (ou en mode degrade).
   */
  async activateWorkflow(n8nWorkflowId: string, active: boolean): Promise<boolean> {
    if (this.degraded()) {
      this.log.warn(
        `activateWorkflow ignore (mode degrade) wf=${n8nWorkflowId} active=${active}`,
      );
      return false;
    }
    const verb = active ? 'activate' : 'deactivate';
    try {
      const res = await fetch(
        `${this.n8nUrl}/api/v1/workflows/${n8nWorkflowId}/${verb}`,
        {
          method: 'POST',
          headers: this.apiHeaders(),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.log.error(
          `activateWorkflow(${verb}) KO (${res.status}) wf=${n8nWorkflowId} : ${text}`,
        );
        return false;
      }
      return true;
    } catch (e) {
      this.log.error(
        `activateWorkflow erreur reseau wf=${n8nWorkflowId} : ${(e as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Declenche un workflow via son webhook public.
   *
   * Le path webhook est derive du templateCode : `mata.daily_cash_report`
   * → `mata-daily-cash-report` (remplacement `.` → `-`).
   *
   * n8n ne renvoie PAS d'execution_id pour un webhook trigger synchrone
   * (sauf en mode `responseMode: 'lastNode'` avec un Respond to Webhook).
   * On retourne `n8nExecutionId: null` par defaut ; si n8n expose le header
   * `x-n8n-execution-id` (rare) on le recupere. Phase 3 enrichira via
   * `getExecutions(workflowId)` apres coup.
   */
  async triggerWebhook(
    templateCode: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: Record<string, any>,
  ): Promise<{ n8nExecutionId: string | null; success: boolean; error?: string }> {
    const webhookPath = templateCode.replace(/\./g, '-');
    if (this.degraded()) {
      this.log.warn(
        `triggerWebhook ignore (mode degrade) template=${templateCode} path=${webhookPath}`,
      );
      return {
        n8nExecutionId: null,
        success: false,
        error: 'N8N_API_KEY non defini (mode degrade)',
      };
    }
    try {
      const res = await fetch(`${this.n8nUrl}/webhook/${webhookPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      });
      const execHeader =
        res.headers.get('x-n8n-execution-id') ?? res.headers.get('x-execution-id');
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.log.error(
          `triggerWebhook KO (${res.status}) template=${templateCode} : ${text}`,
        );
        return {
          n8nExecutionId: execHeader ?? null,
          success: false,
          error: `HTTP ${res.status} ${text || res.statusText}`,
        };
      }
      return {
        n8nExecutionId: execHeader ?? null,
        success: true,
      };
    } catch (e) {
      const errMsg = (e as Error).message ?? 'erreur reseau';
      this.log.error(
        `triggerWebhook erreur reseau template=${templateCode} : ${errMsg}`,
      );
      return {
        n8nExecutionId: null,
        success: false,
        error: errMsg,
      };
    }
  }

  /**
   * Supprime un workflow n8n.
   * Retourne true si supprime (200), false sinon.
   */
  async deleteWorkflow(n8nWorkflowId: string): Promise<boolean> {
    if (this.degraded()) {
      this.log.warn(`deleteWorkflow ignore (mode degrade) wf=${n8nWorkflowId}`);
      return false;
    }
    try {
      const res = await fetch(`${this.n8nUrl}/api/v1/workflows/${n8nWorkflowId}`, {
        method: 'DELETE',
        headers: this.apiHeaders(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.log.error(
          `deleteWorkflow KO (${res.status}) wf=${n8nWorkflowId} : ${text}`,
        );
        return false;
      }
      return true;
    } catch (e) {
      this.log.error(
        `deleteWorkflow erreur reseau wf=${n8nWorkflowId} : ${(e as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Recupere le statut + payload d'une execution n8n.
   * Retourne null si 404 ou erreur.
   */
  async getExecution(
    n8nExecutionId: string,
  ): Promise<{
    status: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any;
  } | null> {
    if (this.degraded()) {
      this.log.warn(`getExecution ignore (mode degrade) exec=${n8nExecutionId}`);
      return null;
    }
    try {
      const res = await fetch(
        `${this.n8nUrl}/api/v1/executions/${n8nExecutionId}`,
        {
          method: 'GET',
          headers: this.apiHeaders(),
        },
      );
      if (res.status === 404) return null;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.log.error(
          `getExecution KO (${res.status}) exec=${n8nExecutionId} : ${text}`,
        );
        return null;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      // n8n retourne typiquement { id, finished, status?, mode, startedAt, stoppedAt, workflowData, data }
      const status: string =
        typeof data.status === 'string'
          ? data.status
          : data.finished === true
            ? 'success'
            : 'running';
      return { status, data };
    } catch (e) {
      this.log.error(
        `getExecution erreur reseau exec=${n8nExecutionId} : ${(e as Error).message}`,
      );
      return null;
    }
  }
}
