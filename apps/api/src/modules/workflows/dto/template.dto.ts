import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * DTO de creation d'un template de workflow (route admin Matix uniquement).
 *
 * `n8n_definition` et `configurable_settings` sont des JSONB libres : on n'impose
 * pas de schema rigide cote API (le contenu vient de l'export n8n + d'une
 * convention Matix). On garde donc `any` la, conformement au cahier des charges.
 */
export class CreateTemplateDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9_.\-]+$/, {
    message: 'code: minuscules/chiffres/_-. uniquement (ex: mata.daily_cash_report)',
  })
  code!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** JSONB libre — contenu d'un export workflow.json n8n. */
  @IsOptional()
  @IsObject()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  n8n_definition?: any;

  /** Liste des parametres modifiables par le tenant (schema libre). */
  @IsArray()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configurable_settings!: any[];

  /** Codes modules Matix requis pour activer ce template. */
  @IsArray()
  @IsString({ each: true })
  required_modules!: string[];

  /** Si non vide, restreint le template a ces tenant_id seulement. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  restricted_to_tenants?: string[];
}

/**
 * DTO de mise a jour partielle d'un template — tous les champs sont optionnels.
 * Le service utilise COALESCE pour ne mettre a jour que les colonnes fournies.
 */
export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsObject()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  n8n_definition?: any;

  @IsOptional()
  @IsArray()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configurable_settings?: any[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_modules?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  restricted_to_tenants?: string[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
