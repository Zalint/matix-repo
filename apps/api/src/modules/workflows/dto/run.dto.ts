/**
 * DTO de reponse pour un run de workflow (audit).
 * Pas de validation entrante — c'est un format de sortie consomme par l'UI.
 */
export type WorkflowRunStatus = 'running' | 'success' | 'error' | 'timeout';
export type WorkflowRunTrigger = 'cron' | 'manual' | 'webhook';

export class WorkflowRunDto {
  id!: string;
  instance_id!: string;
  template_code!: string;
  triggered_by!: WorkflowRunTrigger;
  triggered_by_user!: string | null;
  started_at!: string;
  finished_at!: string | null;
  status!: WorkflowRunStatus;
  duration_ms!: number | null;
  n8n_execution_id!: string | null;
  error_message!: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload_summary!: Record<string, any> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output_summary!: Record<string, any> | null;
}
