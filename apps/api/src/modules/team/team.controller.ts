import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TeamService } from './team.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RequiresRole } from '../../common/auth/roles.decorator';
import { RolesGuard } from '../../common/auth/roles.guard';

@Controller('team')
@UseGuards(RolesGuard)
export class TeamController {
  constructor(private readonly team: TeamService) {}

  /** Tous les membres actifs peuvent voir leur équipe. */
  @Get()
  @RequiresRole('readonly')
  list() {
    return this.team.list();
  }

  @Get(':userId')
  @RequiresRole('readonly')
  getOne(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.team.getById(userId);
  }

  /** owner ou admin peut créer (admin ne peut pas créer d'owner — vérifié dans le service). */
  @Post()
  @RequiresRole('admin')
  create(@Body() dto: CreateMemberDto) {
    return this.team.create(dto);
  }

  /** Seul un owner peut changer un rôle. */
  @Patch(':userId/role')
  @RequiresRole('owner')
  updateRole(@Param('userId', ParseUUIDPipe) userId: string, @Body() dto: UpdateRoleDto) {
    return this.team.updateRole(userId, dto.role);
  }

  /** owner et admin peuvent retirer (sauf cas owner protégé — voir service). */
  @Delete(':userId')
  @HttpCode(204)
  @RequiresRole('admin')
  async remove(@Param('userId', ParseUUIDPipe) userId: string) {
    await this.team.remove(userId);
  }
}
