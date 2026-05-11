import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Une ligne de sortie : un produit fini + sa quantité.
 * Le coût unitaire est optionnel ; s'il est omis, le service le calculera au
 * prorata du poids si la source a un unit_cost connu.
 */
export class CuttingOutputDto {
  @IsUUID() product_id!: string;
  @IsNumber() @Min(0.001) quantity!: number;
  @IsOptional() @IsNumber() @Min(0) unit_cost?: number;
}

/**
 * Création d'une découpe : 1 source + N sorties. La chute n'est pas saisie,
 * elle est calculée par le service (source_quantity − Σ outputs.quantity).
 *
 * Le service garantit l'atomicité : tous les mouvements de stock sont insérés
 * dans la même transaction que la ligne stock_cuttings.
 */
export class CreateCuttingDto {
  @IsUUID() point_of_sale_id!: string;
  @IsUUID() source_product_id!: string;
  @IsNumber() @Min(0.001) source_quantity!: number;
  @IsOptional() @IsNumber() @Min(0) source_unit_cost?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CuttingOutputDto)
  outputs!: CuttingOutputDto[];

  /** Si omis : NOW() côté DB. Sinon utile pour saisie retroactive. */
  @IsOptional() @IsDateString() performed_at?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
