import { IsEmail, IsIn, IsString, Length, MaxLength, MinLength } from 'class-validator';
import type { TenantRole } from '../../../common/auth/roles.decorator';

export const TENANT_ROLES: TenantRole[] = ['owner', 'admin', 'superviseur', 'member', 'readonly'];

export class CreateMemberDto {
  @IsEmail() email!: string;
  @IsString() @Length(1, 100) first_name!: string;
  @IsString() @Length(1, 100) last_name!: string;
  /** Mode A — mot de passe initial transmis directement à l'utilisateur. */
  @IsString() @MinLength(8) @MaxLength(72) password!: string;

  @IsIn(TENANT_ROLES, { message: `role doit être l'un de : ${TENANT_ROLES.join(', ')}` })
  role!: TenantRole;
}
