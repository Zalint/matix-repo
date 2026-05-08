import { Type } from 'class-transformer';
import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ProvisionTenantOwnerDto {
  @IsEmail() email!: string;
  @IsString() @MaxLength(100) first_name!: string;
  @IsString() @MaxLength(100) last_name!: string;
  /** Password initial — Phase 1 : envoyer un mail d'invitation à la place. */
  @IsString() @MinLength(8) @MaxLength(72) password!: string;
}

export class ProvisionTenantDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{1,40}[a-z0-9]$/, {
    message: 'slug: lowercase, lettres/chiffres/-, 3-40 chars, démarre par une lettre',
  })
  slug!: string;

  @IsString() @Length(2, 200) legal_name!: string;

  @IsOptional() @IsString() @Length(2, 2) country_code?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() @MaxLength(20) ninea?: string;
  @IsOptional() @IsString() @MaxLength(20) rc?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => ProvisionTenantOwnerDto)
  owner!: ProvisionTenantOwnerDto;
}
