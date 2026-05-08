import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class CreatePointOfSaleDto {
  @IsString()
  @Length(1, 30)
  @Matches(/^[a-z0-9][a-z0-9_-]*$/i, { message: 'code: lettres/chiffres/_-, démarre par lettre ou chiffre' })
  code!: string;

  @IsString() @Length(1, 100) name!: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}
