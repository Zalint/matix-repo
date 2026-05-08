import { IsIn } from 'class-validator';
import { TENANT_ROLES } from './create-member.dto';
import type { TenantRole } from '../../../common/auth/roles.decorator';

export class UpdateRoleDto {
  @IsIn(TENANT_ROLES) role!: TenantRole;
}
