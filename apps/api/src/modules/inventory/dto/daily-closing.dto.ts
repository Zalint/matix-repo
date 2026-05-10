import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

/**
 * Saisie / override d'un stock soir pour (date, pos, produit).
 *
 * Force toujours source='manual' cote service. Le mode 'auto' est produit
 * uniquement par recomputeAuto() et le cron nightly carry-over.
 */
export class SetDailyClosingDto {
  @IsDateString() closing_date!: string;        // YYYY-MM-DD
  @IsUUID() point_of_sale_id!: string;
  @IsUUID() product_id!: string;
  @IsNumber() @Min(0) quantity!: number;
}

/**
 * Recalcul auto pour un (date, pos?) — les produits en mode 'automatique'
 * sont recalcules ; les produits 'manuel' ou deja saisis manuellement ne
 * sont pas touches.
 */
export class RecomputeAutoDto {
  @IsDateString() closing_date!: string;
  @IsOptional() @IsUUID() point_of_sale_id?: string;
}

/** Note libre par (date, pos) — Phase B reconciliation. */
export class SetReconciliationNoteDto {
  @IsDateString() note_date!: string;
  @IsUUID() point_of_sale_id!: string;
  @IsOptional() body?: string;     // string vide autorise (= effacement implicite)
}
