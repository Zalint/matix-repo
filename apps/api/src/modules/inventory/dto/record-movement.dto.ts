import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export enum MovementType {
  OPENING = 'opening',
  SALE = 'sale',
  RETURN = 'return',
  ADJUSTMENT = 'adjustment',
  TRANSFER_IN = 'transfer_in',
  TRANSFER_OUT = 'transfer_out',
  CLOSING = 'closing',
}

export class RecordMovementDto {
  @IsUUID() product_id!: string;
  @IsUUID() point_of_sale_id!: string;

  @IsEnum(MovementType) movement_type!: MovementType;

  /** Signed: positif = entrée, négatif = sortie. Doit être ≠ 0. */
  @IsNumber() quantity!: number;

  @IsOptional() @IsNumber() unit_cost?: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;

  // reference_table / reference_id sont posés côté service par les autres modules
  // (ex: Sales pose reference_table='sales' + sale_id). Pas exposé en DTO public.
}
