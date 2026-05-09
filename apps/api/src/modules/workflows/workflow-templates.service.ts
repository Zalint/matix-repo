import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { ADMIN_PG_POOL } from '../../common/database.module';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';

export type WorkflowTemplate = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  n8n_definition: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configurable_settings: any[];
  required_modules: string[];
  restricted_to_tenants: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const COLS = `
  id, code, name, description, n8n_definition, configurable_settings,
  required_modules, restricted_to_tenants, is_active, created_at, updated_at
`;

/**
 * Service ADMIN — gere les templates de workflows globaux (table sans tenant_id).
 *
 * Utilise ADMIN_PG_POOL (BYPASSRLS) car la table workflow_templates est globale
 * et ne porte pas de RLS — seuls les super-admins Matix la modifient.
 */
@Injectable()
export class WorkflowTemplatesService {
  private readonly log = new Logger(WorkflowTemplatesService.name);

  constructor(@Inject(ADMIN_PG_POOL) private readonly pool: Pool) {}

  async listAll(): Promise<WorkflowTemplate[]> {
    const { rows } = await this.pool.query<WorkflowTemplate>(
      `SELECT ${COLS} FROM workflow_templates ORDER BY code ASC`,
    );
    return rows;
  }

  async getByCode(code: string): Promise<WorkflowTemplate> {
    const { rows } = await this.pool.query<WorkflowTemplate>(
      `SELECT ${COLS} FROM workflow_templates WHERE code = $1`,
      [code],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Template "${code}" introuvable`);
    }
    return rows[0];
  }

  async create(dto: CreateTemplateDto): Promise<WorkflowTemplate> {
    try {
      const { rows } = await this.pool.query<WorkflowTemplate>(
        `INSERT INTO workflow_templates
           (code, name, description, n8n_definition, configurable_settings,
            required_modules, restricted_to_tenants)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
         RETURNING ${COLS}`,
        [
          dto.code,
          dto.name,
          dto.description ?? null,
          dto.n8n_definition ? JSON.stringify(dto.n8n_definition) : null,
          JSON.stringify(dto.configurable_settings),
          dto.required_modules,
          dto.restricted_to_tenants ?? [],
        ],
      );
      this.log.log(`Template cree: ${dto.code}`);
      return rows[0];
    } catch (e: unknown) {
      // 23505 = unique violation Postgres
      if (
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e as { code: string }).code === '23505'
      ) {
        throw new ConflictException(`Un template avec le code "${dto.code}" existe deja`);
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateTemplateDto): Promise<WorkflowTemplate> {
    const { rows } = await this.pool.query<WorkflowTemplate>(
      `UPDATE workflow_templates SET
         name                  = COALESCE($2, name),
         description           = COALESCE($3, description),
         n8n_definition        = COALESCE($4::jsonb, n8n_definition),
         configurable_settings = COALESCE($5::jsonb, configurable_settings),
         required_modules      = COALESCE($6, required_modules),
         restricted_to_tenants = COALESCE($7, restricted_to_tenants),
         is_active             = COALESCE($8, is_active),
         updated_at            = NOW()
       WHERE id = $1
       RETURNING ${COLS}`,
      [
        id,
        dto.name ?? null,
        dto.description ?? null,
        dto.n8n_definition ? JSON.stringify(dto.n8n_definition) : null,
        dto.configurable_settings ? JSON.stringify(dto.configurable_settings) : null,
        dto.required_modules ?? null,
        dto.restricted_to_tenants ?? null,
        dto.is_active ?? null,
      ],
    );
    if (rows.length === 0) {
      throw new NotFoundException('Template introuvable');
    }
    this.log.log(`Template mis a jour: ${rows[0].code}`);
    return rows[0];
  }

  async delete(id: string): Promise<void> {
    const { rowCount } = await this.pool.query(`DELETE FROM workflow_templates WHERE id = $1`, [
      id,
    ]);
    if (rowCount === 0) {
      throw new NotFoundException('Template introuvable');
    }
    this.log.warn(`Template supprime (id=${id}) — instances tenant cascadees`);
  }

  async setActive(id: string, isActive: boolean): Promise<WorkflowTemplate> {
    const { rows } = await this.pool.query<WorkflowTemplate>(
      `UPDATE workflow_templates SET is_active = $2, updated_at = NOW() WHERE id = $1
       RETURNING ${COLS}`,
      [id, isActive],
    );
    if (rows.length === 0) {
      throw new NotFoundException('Template introuvable');
    }
    this.log.log(`Template ${rows[0].code} → is_active=${isActive}`);
    return rows[0];
  }
}
