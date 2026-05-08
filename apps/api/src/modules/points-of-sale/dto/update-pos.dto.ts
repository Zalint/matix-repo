import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UpdatePointOfSaleDto {
  @IsOptional() @IsString() @Length(1, 100) name?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}
