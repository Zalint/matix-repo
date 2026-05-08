import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_-]+$/i, { message: 'code: lettres/chiffres/_- uniquement' })
  code!: string;

  @IsString()
  @MaxLength(200)
  display_name!: string;

  @IsOptional() @IsEmail() email?: string;

  /** Format E.164 préféré (+221xxxxxxxxx). Validation laxiste — Africa = beaucoup de formats. */
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9 ()-]{7,20}$/, { message: 'phone: format invalide' })
  phone?: string;

  @IsOptional() @IsString() @MaxLength(500) address?: string;

  @IsOptional() @IsString() @MaxLength(50) segment?: string;

  @IsOptional() @IsNumber() @Min(0) credit_limit?: number;

  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
