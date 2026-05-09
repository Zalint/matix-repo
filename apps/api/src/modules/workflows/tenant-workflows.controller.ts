import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequiresModule } from '../licensing/licensing.decorator';
import {
  ActivateWorkflowDto,
  UpdateSettingsDto,
} from './dto/tenant-workflow.dto';
import { TenantWorkflowsService } from './tenant-workflows.service';

/**
 * Controller TENANT — vue cote utilisateur d'un tenant.
 * Toutes les routes sont protegees par @RequiresModule('platform.workflows', ...).
 */
@Controller('workflows')
export class TenantWorkflowsController {
  constructor(private readonly tenantWorkflows: TenantWorkflowsService) {}

  /** Liste des templates qu'un tenant peut activer (filtre licences + restrictions). */
  @Get('templates')
  @RequiresModule('platform.workflows', 'read')
  listTemplates() {
    return this.tenantWorkflows.listAvailableTemplates();
  }

  /** Liste des instances de workflow du tenant (activees ou non). */
  @Get('instances')
  @RequiresModule('platform.workflows', 'read')
  listInstances() {
    return this.tenantWorkflows.listMyInstances();
  }

  /** Active un template pour ce tenant — clone n8n + insert tenant_workflow_instances. */
  @Post('activate')
  @RequiresModule('platform.workflows', 'write')
  activate(@Body() dto: ActivateWorkflowDto) {
    return this.tenantWorkflows.activate(dto.template_code, dto.custom_settings);
  }

  /** Met a jour les settings (cron, destinataires...) d'une instance. */
  @Patch('instances/:id/settings')
  @RequiresModule('platform.workflows', 'write')
  updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.tenantWorkflows.updateSettings(id, dto.custom_settings);
  }

  /** Desactive une instance (sans supprimer — on garde l'historique). */
  @Post('instances/:id/disable')
  @RequiresModule('platform.workflows', 'write')
  disable(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantWorkflows.disable(id);
  }

  /** Reactive une instance (re-clone n8n si n8n_workflow_id manquant). */
  @Post('instances/:id/enable')
  @RequiresModule('platform.workflows', 'write')
  enable(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantWorkflows.enable(id);
  }

  /** Declenchement manuel a la demande — cree un workflow_run audite. */
  @Post('instances/:id/trigger')
  @RequiresModule('platform.workflows', 'write')
  trigger(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantWorkflows.triggerNow(id);
  }

  /**
   * Historique des executions du tenant.
   * Filtrable par instance_id (query param). RLS auto-applique.
   */
  @Get('runs')
  @RequiresModule('platform.workflows', 'read')
  listRuns(
    @Query('instance_id') instanceId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tenantWorkflows.listRuns(
      instanceId,
      limit ? Number(limit) : undefined,
    );
  }
}
