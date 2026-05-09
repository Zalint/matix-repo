import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { WorkflowTemplatesService } from './workflow-templates.service';

/**
 * Controller ADMIN — gestion des templates de workflows globaux.
 *
 * Routes /admin/* — non scope tenant. Utilise ADMIN_PG_POOL en backend.
 *
 * TODO: protect with super-admin guard
 *  Phase 0 : non protege (au meme niveau que /admin/licensing).
 *  Phase 1+ : un guard super-admin Matix devra etre applique ici (cookie/JWT
 *  super-admin distinct des JWT tenant Keycloak).
 */
@Controller('admin/workflow-templates')
export class WorkflowTemplatesController {
  constructor(private readonly templates: WorkflowTemplatesService) {}

  @Get()
  list() {
    return this.templates.listAll();
  }

  @Get(':code')
  getByCode(@Param('code') code: string) {
    return this.templates.getByCode(code);
  }

  @Post()
  create(@Body() dto: CreateTemplateDto) {
    return this.templates.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templates.update(id, dto);
  }

  @Patch(':id/active')
  setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { is_active: boolean },
  ) {
    return this.templates.setActive(id, !!body.is_active);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.templates.delete(id);
  }
}
