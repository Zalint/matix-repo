import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Pool } from 'pg';
import { ADMIN_PG_POOL } from '../../common/database.module';
import { KeycloakAdminService } from '../../common/keycloak/keycloak-admin.service';
import type { TenantRole } from '../../common/auth/roles.decorator';
import type { CreateMemberDto } from './dto/create-member.dto';

export type TeamMember = {
  user_id: string;
  email: string;
  role: TenantRole;
  created_at: string;
  deactivated_at: string | null;
};

/**
 * Gestion des membres du tenant courant.
 *
 * Règles :
 *  - Tout membre actif peut LISTER les membres de son tenant.
 *  - owner / admin peuvent CRÉER un nouveau membre, à condition que le rôle
 *    attribué soit ≤ leur propre rôle (un admin ne peut pas créer un owner).
 *  - Seul un OWNER peut UPDATE le rôle d'un autre membre, ou le DELETE.
 *  - On ne peut JAMAIS retirer le DERNIER owner d'un tenant — sécurité.
 *  - Si l'email existe déjà dans Keycloak (= user multi-tenant), on ajoute
 *    juste tenant_ids[] sur lui plutôt que de le re-créer.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly cls: ClsService,
    @Inject(ADMIN_PG_POOL) private readonly pool: Pool,
    private readonly keycloak: KeycloakAdminService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(): Promise<TeamMember[]> {
    const tenantId = this.tenantId();
    const { rows } = await this.pool.query<TeamMember>(
      `SELECT user_id, email, role, created_at, deactivated_at
         FROM tenant_members
        WHERE tenant_id = $1
        ORDER BY created_at ASC`,
      [tenantId],
    );
    return rows;
  }

  async getById(userId: string): Promise<TeamMember> {
    const tenantId = this.tenantId();
    const { rows } = await this.pool.query<TeamMember>(
      `SELECT user_id, email, role, created_at, deactivated_at
         FROM tenant_members
        WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId],
    );
    if (rows.length === 0) throw new NotFoundException('Membre introuvable');
    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  async create(dto: CreateMemberDto): Promise<TeamMember & { user_id: string }> {
    const tenantId = this.tenantId();
    const callerRole = this.callerRole();

    // Pas le droit d'attribuer un rôle plus haut que le sien
    if (this.roleLevel(dto.role) > this.roleLevel(callerRole)) {
      throw new ForbiddenException(
        `Impossible d'attribuer le rôle ${dto.role} : votre propre rôle est ${callerRole}`,
      );
    }

    // Email déjà membre de ce tenant ?
    const existing = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM tenant_members WHERE tenant_id = $1 AND email = $2`,
      [tenantId, dto.email.toLowerCase()],
    );
    if (existing.rowCount) {
      throw new ConflictException(`Un membre avec l'email ${dto.email} existe déjà dans ce tenant`);
    }

    // Existe-t-il déjà dans Keycloak ? (cas user multi-tenant)
    const kcUserId = await this.keycloak.findUserByEmail(dto.email);
    let userId: string;

    if (kcUserId) {
      // User existant : on ajoute ce tenant à ses tenant_ids[]
      await this.keycloak.addTenantToUser(kcUserId, tenantId);
      userId = kcUserId;
    } else {
      // Nouveau user
      const created = await this.keycloak.createUser({
        email: dto.email,
        first_name: dto.first_name,
        last_name: dto.last_name,
        password: dto.password,
        tenant_id: tenantId,
        roles: [dto.role],
        email_verified: true,
      });
      userId = created.user_id;
    }

    // Insère tenant_members
    await this.pool.query(
      `INSERT INTO tenant_members (tenant_id, user_id, email, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, user_id) DO UPDATE
         SET role = EXCLUDED.role, deactivated_at = NULL`,
      [tenantId, userId, dto.email.toLowerCase(), dto.role],
    );

    return this.getById(userId);
  }

  // ---------------------------------------------------------------------------
  // Update role
  // ---------------------------------------------------------------------------

  async updateRole(userId: string, newRole: TenantRole): Promise<TeamMember> {
    const tenantId = this.tenantId();
    const callerRole = this.callerRole();
    const callerId = this.callerUserId();

    // Seul un owner peut changer les rôles
    if (callerRole !== 'owner') {
      throw new ForbiddenException('Seul un owner peut changer les rôles');
    }

    const target = await this.getById(userId);

    // Si on retire le rôle owner d'un user, vérifier qu'il reste au moins un autre owner
    if (target.role === 'owner' && newRole !== 'owner') {
      await this.assertNotLastOwner(tenantId, userId);
    }

    // L'owner peut s'autodémouvoir SEULEMENT s'il y a d'autres owners
    if (callerId === userId && newRole !== 'owner') {
      await this.assertNotLastOwner(tenantId, userId);
    }

    await this.pool.query(
      `UPDATE tenant_members SET role = $3 WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId, newRole],
    );

    return this.getById(userId);
  }

  // ---------------------------------------------------------------------------
  // Remove (soft)
  // ---------------------------------------------------------------------------

  async remove(userId: string): Promise<void> {
    const tenantId = this.tenantId();
    const callerRole = this.callerRole();
    const callerId = this.callerUserId();

    if (callerRole !== 'owner' && callerRole !== 'admin') {
      throw new ForbiddenException('Seuls owner et admin peuvent retirer un membre');
    }

    const target = await this.getById(userId);

    // Un admin ne peut pas retirer un owner
    if (callerRole === 'admin' && target.role === 'owner') {
      throw new ForbiddenException('Un admin ne peut pas retirer un owner');
    }

    // Pas de retrait du dernier owner
    if (target.role === 'owner') {
      await this.assertNotLastOwner(tenantId, userId);
    }

    // Auto-retrait : autorisé sauf si on est le dernier owner
    if (callerId === userId && target.role === 'owner') {
      await this.assertNotLastOwner(tenantId, userId);
    }

    await this.pool.query(
      `UPDATE tenant_members SET deactivated_at = NOW()
       WHERE tenant_id = $1 AND user_id = $2 AND deactivated_at IS NULL`,
      [tenantId, userId],
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private tenantId(): string {
    const id = this.cls.get<string>('tenantId');
    if (!id) throw new BadRequestException('tenant_id manquant dans le contexte');
    return id;
  }

  private callerUserId(): string {
    const id = this.cls.get<string>('userId');
    if (!id) throw new BadRequestException('user_id manquant dans le contexte');
    return id;
  }

  private callerRole(): TenantRole {
    const role = this.cls.get<TenantRole>('role');
    if (!role) throw new BadRequestException('role manquant dans le contexte');
    return role;
  }

  private roleLevel(r: TenantRole): number {
    return { system: 6, owner: 5, admin: 4, superviseur: 3, member: 2, readonly: 1 }[r];
  }

  private async assertNotLastOwner(tenantId: string, excludingUserId: string): Promise<void> {
    const { rows } = await this.pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM tenant_members
        WHERE tenant_id = $1 AND role = 'owner' AND user_id <> $2 AND deactivated_at IS NULL`,
      [tenantId, excludingUserId],
    );
    if (Number(rows[0].c) === 0) {
      throw new ConflictException('Impossible — ce serait le dernier owner du tenant');
    }
  }
}
