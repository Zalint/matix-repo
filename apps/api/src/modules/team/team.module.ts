import { Module } from '@nestjs/common';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';
import { KeycloakAdminService } from '../../common/keycloak/keycloak-admin.service';

export const MODULE_MANIFEST = {
  name: 'team',
  pillar: 'platform' as const,
  tables: ['tenant_members'] as const,
  emitsEvents: [] as const,
  publicFacade: 'TeamService',
};

@Module({
  controllers: [TeamController],
  providers: [TeamService, KeycloakAdminService],
})
export class TeamModule {}
