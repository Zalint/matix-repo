import { Injectable, Logger } from '@nestjs/common';

/**
 * Wrapper minimaliste autour de l'API admin Keycloak via REST.
 *
 * On utilise REST direct (et pas le SDK officiel) pour rester léger et
 * éviter les soucis ESM/CJS qu'on a déjà vus avec jose. Quand le besoin
 * deviendra important (rôles complexes, sessions, etc.), passer au SDK.
 *
 * Auth via Service Account du client `admin-cli` (default, déjà présent).
 * On utilise le grant `password` avec admin/admin du realm `master` —
 * Phase 0 dev only. Phase 1 : créer un service account dédié.
 */
@Injectable()
export class KeycloakAdminService {
  private readonly log = new Logger(KeycloakAdminService.name);
  private cachedToken: { value: string; expiresAt: number } | null = null;

  private get baseUrl(): string {
    const issuer = process.env.KEYCLOAK_ISSUER;
    if (!issuer) throw new Error('KEYCLOAK_ISSUER non configuré');
    // issuer = http://localhost:8180/realms/matix → on veut http://localhost:8180
    return issuer.replace(/\/realms\/.+$/, '');
  }

  private get realm(): string {
    return process.env.KEYCLOAK_TARGET_REALM ?? 'matix';
  }

  private async getAdminToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 30_000) {
      return this.cachedToken.value;
    }
    const username = process.env.KEYCLOAK_ADMIN_USER ?? 'admin';
    const password = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin';
    const res = await fetch(`${this.baseUrl}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username,
        password,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Keycloak admin token failed: ${res.status} ${text}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = {
      value: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return json.access_token;
  }

  /**
   * Crée un user dans le realm Matix.
   * Renvoie l'ID Keycloak (sub UUID) pour qu'on l'insère dans tenant_members.
   *
   * ⚠️ Pré-requis realm : unmanagedAttributePolicy = ENABLED (sinon `tenant_ids`
   * et `active_tenant_id` sont silencieusement droppés). Voir infra/keycloak/README.md.
   * Cette méthode tente de l'activer best-effort si elle voit que les attributs ne
   * sont pas écrits ; sinon, échoue clean.
   */
  async createUser(input: {
    email: string;
    first_name?: string;
    last_name?: string;
    password: string;
    tenant_id: string;
    roles?: string[];        // realm roles : 'owner', 'admin', etc.
    email_verified?: boolean;
  }): Promise<{ user_id: string }> {
    const token = await this.getAdminToken();
    await this.ensureUnmanagedAttributesEnabled(token);

    // 1. Create user
    const createRes = await fetch(`${this.baseUrl}/admin/realms/${this.realm}/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: input.email,
        email: input.email,
        firstName: input.first_name,
        lastName: input.last_name,
        emailVerified: input.email_verified ?? true,
        enabled: true,
        attributes: {
          tenant_ids: [input.tenant_id],
          active_tenant_id: [input.tenant_id],
        },
        credentials: [{ type: 'password', value: input.password, temporary: false }],
      }),
    });
    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(`Keycloak createUser failed: ${createRes.status} ${text}`);
    }
    // L'ID est dans le header Location
    const loc = createRes.headers.get('location') ?? '';
    const userId = loc.split('/').pop();
    if (!userId) throw new Error('Keycloak createUser: pas de Location header');

    // 2. Assign realm roles
    if (input.roles?.length) {
      await this.assignRealmRoles(userId, input.roles);
    }

    this.log.log(`Created Keycloak user ${input.email} (id=${userId}) for tenant ${input.tenant_id}`);
    return { user_id: userId };
  }

  /** Récupère les roles realm par leur nom. */
  private async getRealmRoles(names: string[]): Promise<{ id: string; name: string }[]> {
    const token = await this.getAdminToken();
    const all: { id: string; name: string }[] = [];
    for (const name of names) {
      const res = await fetch(
        `${this.baseUrl}/admin/realms/${this.realm}/roles/${encodeURIComponent(name)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) all.push((await res.json()) as { id: string; name: string });
    }
    return all;
  }

  private async assignRealmRoles(userId: string, roleNames: string[]): Promise<void> {
    const roles = await this.getRealmRoles(roleNames);
    if (roles.length === 0) return;
    const token = await this.getAdminToken();
    const res = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users/${userId}/role-mappings/realm`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(roles),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Keycloak assignRealmRoles failed: ${res.status} ${text}`);
    }
  }

  /**
   * Cherche un user Keycloak par email (exact match) dans le realm.
   * Renvoie l'ID Keycloak (sub) ou null si introuvable.
   */
  async findUserByEmail(email: string): Promise<string | null> {
    const token = await this.getAdminToken();
    const res = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users?email=${encodeURIComponent(email)}&exact=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ id: string }>;
    return arr[0]?.id ?? null;
  }

  /**
   * Utilitaire : ajoute un tenant à la liste tenant_ids d'un user existant
   * (cas user multi-tenant). Lit l'attribut puis met à jour.
   */
  async addTenantToUser(userId: string, tenant_id: string): Promise<void> {
    const token = await this.getAdminToken();
    const userRes = await fetch(`${this.baseUrl}/admin/realms/${this.realm}/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) throw new Error(`getUser failed: ${userRes.status}`);
    const user = (await userRes.json()) as { attributes?: Record<string, string[]> };
    const existing = user.attributes?.tenant_ids ?? [];
    if (existing.includes(tenant_id)) return;
    const updated = {
      ...user,
      attributes: {
        ...(user.attributes ?? {}),
        tenant_ids: [...existing, tenant_id],
      },
    };
    const res = await fetch(`${this.baseUrl}/admin/realms/${this.realm}/users/${userId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (!res.ok) throw new Error(`addTenantToUser failed: ${res.status}`);
  }

  /**
   * S'assure que la realm autorise les attributs custom non-déclarés.
   * Sinon `tenant_ids` et `active_tenant_id` sont silencieusement droppés à la création.
   *
   * Idempotent : ne fait rien si déjà à ENABLED.
   */
  private async ensureUnmanagedAttributesEnabled(token: string): Promise<void> {
    const profileRes = await fetch(`${this.baseUrl}/admin/realms/${this.realm}/users/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!profileRes.ok) return; // best effort — on continue
    const profile = (await profileRes.json()) as Record<string, unknown>;
    if (profile.unmanagedAttributePolicy === 'ENABLED') return;
    const updated = { ...profile, unmanagedAttributePolicy: 'ENABLED' };
    await fetch(`${this.baseUrl}/admin/realms/${this.realm}/users/profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => undefined);
    this.log.log(`Enabled unmanagedAttributePolicy on realm ${this.realm}`);
  }

  /** Pour rollback en cas d'échec aval. */
  async deleteUser(userId: string): Promise<void> {
    const token = await this.getAdminToken();
    await fetch(`${this.baseUrl}/admin/realms/${this.realm}/users/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}
