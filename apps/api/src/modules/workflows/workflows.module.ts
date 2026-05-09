import { Module } from '@nestjs/common';
import { N8nClientService } from './n8n-client.service';
import { TenantWorkflowsController } from './tenant-workflows.controller';
import { TenantWorkflowsService } from './tenant-workflows.service';
import { WorkflowSchedulerService } from './workflow-scheduler.service';
import { WorkflowTemplatesController } from './workflow-templates.controller';
import { WorkflowTemplatesService } from './workflow-templates.service';

/**
 * Module manifest — voir ADR-0002 §6.
 */
export const MODULE_MANIFEST = {
  name: 'workflows',
  pillar: 'platform' as const,
  tables: [
    'workflow_templates',
    'tenant_workflow_instances',
    'workflow_runs',
  ] as const,
  emitsEvents: [] as const,
  publicFacade: null,
};

/**
 * Module Workflows — backbone Strategie C de la Phase 2.
 *
 * Matix orchestre les workflows ; n8n est l'engine d'execution (cache derriere
 * cette API). Le tenant ne voit jamais n8n directement.
 *
 * Composants :
 *  - WorkflowTemplatesService : CRUD admin sur workflow_templates (table globale)
 *  - TenantWorkflowsService   : activation + parametrage par tenant (RLS)
 *  - WorkflowSchedulerService : tick cron interne + fire(instance_id)
 *  - N8nClientService         : wrapper HTTP n8n (stub Phase 2 initiale)
 *
 * Dependances:
 *  - DatabaseModule (global) pour ADMIN_PG_POOL et le client tenant via CLS.
 *  - LicensingModule (global) pour @RequiresModule('platform.workflows', ...).
 */
@Module({
  controllers: [WorkflowTemplatesController, TenantWorkflowsController],
  providers: [
    WorkflowTemplatesService,
    TenantWorkflowsService,
    WorkflowSchedulerService,
    N8nClientService,
  ],
  exports: [WorkflowTemplatesService, TenantWorkflowsService, N8nClientService],
})
export class WorkflowsModule {}
