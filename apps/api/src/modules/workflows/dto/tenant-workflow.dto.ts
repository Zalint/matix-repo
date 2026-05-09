import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO d'activation d'un workflow par un tenant.
 *
 * `template_code` reference un workflow_templates.code (ex: 'mata.daily_cash_report').
 * `custom_settings` est libre — il sera valide cote service contre les
 * `configurable_settings` du template (TODO Phase 2 : validation stricte).
 */
export class ActivateWorkflowDto {
  @IsString()
  @MaxLength(100)
  template_code!: string;

  @IsOptional()
  @IsObject()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  custom_settings?: Record<string, any>;
}

/**
 * DTO de mise a jour des settings d'une instance existante.
 */
export class UpdateSettingsDto {
  @IsObject()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  custom_settings!: Record<string, any>;
}
