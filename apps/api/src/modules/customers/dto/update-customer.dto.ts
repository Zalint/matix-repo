import { IsEmail, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

/**
 * Note : on ne permet PAS de modifier `code` (la référence stable du client).
 * Si besoin, ce sera un endpoint dédié plus tard (avec audit).
 */
export class UpdateCustomerDto {
  @IsOptional() @IsString() @MaxLength(200) display_name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @Matches(/^\+?[0-9 ()-]{7,20}$/) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(50) segment?: string;
  @IsOptional() @IsNumber() @Min(0) credit_limit?: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
