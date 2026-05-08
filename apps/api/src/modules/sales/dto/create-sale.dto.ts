import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export enum PaymentMethod {
  CASH = 'cash',
  WAVE = 'wave',
  ORANGE_MONEY = 'orange_money',
  MTN_MOMO = 'mtn_momo',
  CARD = 'card',
  CREDIT = 'credit',
}

export class CreateSaleItemDto {
  @IsUUID() product_id!: string;
  @IsNumber() @Min(0.001) quantity!: number;
  @IsOptional() @IsNumber() @Min(0) unit_price?: number;        // override prix produit
  @IsOptional() @IsNumber() @Min(0) discount_amount?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(0.9999) tax_rate?: number;
}

export class CreateSalePaymentDto {
  @IsEnum(PaymentMethod) method!: PaymentMethod;
  @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

export class CreateSaleDto {
  @IsUUID() point_of_sale_id!: string;
  @IsOptional() @IsUUID() customer_id?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  items!: CreateSaleItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSalePaymentDto)
  payments?: CreateSalePaymentDto[];

  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  /** Si true, créé + post + décrément stock immédiatement (mode POS rapide). */
  @IsOptional() @IsBoolean() auto_post?: boolean;
}
