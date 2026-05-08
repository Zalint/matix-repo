/**
 * Crée un user Keycloak owner pour chaque tenant Matix qui n'en a pas encore.
 *
 * Utile après seed-from-maas.ts (qui insère directement en DB sans passer par
 * le provisioning Keycloak).
 *
 * Idempotent : skippe les tenants qui ont déjà ≥ 1 tenant_member.
 *
 * Usage :
 *   pnpm --filter @matix/api db:seed:kc-users
 */
import { Pool } from 'pg';

const KC_BASE = process.env.KEYCLOAK_BASE ?? 'http://localhost:8180';
const KC_REALM = process.env.KEYCLOAK_TARGET_REALM ?? 'matix';
const KC_ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER ?? 'admin';
const KC_ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin';

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${KC_BASE}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: KC_ADMIN_USER,
      password: KC_ADMIN_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Keycloak admin login failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function ensureUnmanagedAttrs(token: string): Promise<void> {
  const get = await fetch(`${KC_BASE}/admin/realms/${KC_REALM}/users/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!get.ok) return;
  const profile = (await get.json()) as Record<string, unknown>;
  if (profile.unmanagedAttributePolicy === 'ENABLED') return;
  await fetch(`${KC_BASE}/admin/realms/${KC_REALM}/users/profile`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...profile, unmanagedAttributePolicy: 'ENABLED' }),
  });
}

async function findUserByEmail(token: string, email: string): Promise<string | null> {
  const r = await fetch(
    `${KC_BASE}/admin/realms/${KC_REALM}/users?email=${encodeURIComponent(email)}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) return null;
  const arr = (await r.json()) as Array<{ id: string }>;
  return arr[0]?.id ?? null;
}

async function createUser(
  token: string,
  email: string,
  firstName: string,
  lastName: string,
  password: string,
  tenantId: string,
): Promise<string> {
  const res = await fetch(`${KC_BASE}/admin/realms/${KC_REALM}/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: email,
      email,
      firstName,
      lastName,
      emailVerified: true,
      enabled: true,
      attributes: {
        tenant_ids: [tenantId],
        active_tenant_id: [tenantId],
      },
      credentials: [{ type: 'password', value: password, temporary: false }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createUser failed: ${res.status} ${text}`);
  }
  const loc = res.headers.get('location') ?? '';
  const id = loc.split('/').pop();
  if (!id) throw new Error('No Location header from createUser');
  return id;
}

async function assignOwnerRole(token: string, userId: string): Promise<void> {
  const r = await fetch(`${KC_BASE}/admin/realms/${KC_REALM}/roles/owner`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    console.warn(`  ⚠ rôle 'owner' introuvable : ${r.status}`);
    return;
  }
  const role = await r.json();
  await fetch(`${KC_BASE}/admin/realms/${KC_REALM}/users/${userId}/role-mappings/realm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([role]),
  });
}

async function main() {
  const matix = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'matix',
    user: process.env.POSTGRES_ADMIN_USER ?? 'matix_admin',
    password: process.env.POSTGRES_ADMIN_PASSWORD ?? 'matix_admin_dev',
  });

  // Tenants sans Keycloak owner = pas d'entry tenant_members avec un user_id non-fake
  // (les fake dev IDs commencent par 'a1111...' ou 'b2222...').
  const tenants = await matix.query<{ id: string; slug: string; legal_name: string }>(
    `SELECT id, slug, legal_name FROM tenants WHERE deleted_at IS NULL AND slug LIKE 'mata-%' ORDER BY slug`,
  );

  if (tenants.rows.length === 0) {
    console.log('Aucun tenant mata-* à provisionner.');
    await matix.end();
    return;
  }

  const adminToken = await getAdminToken();
  await ensureUnmanagedAttrs(adminToken);

  for (const t of tenants.rows) {
    const email = `owner@${t.slug}.test`;
    const password = 'Maas2026!';
    console.log(`\n=== ${t.slug} (${t.id.substring(0, 8)}…) ===`);

    let kcUserId = await findUserByEmail(adminToken, email);
    if (kcUserId) {
      console.log(`  Keycloak user existe déjà (${kcUserId.substring(0, 8)}…)`);
    } else {
      kcUserId = await createUser(adminToken, email, 'Owner', t.legal_name, password, t.id);
      await assignOwnerRole(adminToken, kcUserId);
      console.log(`  Keycloak user créé : ${email} / ${password}  (${kcUserId.substring(0, 8)}…)`);
    }

    // Insère tenant_members si absent
    const inserted = await matix.query(
      `INSERT INTO tenant_members (tenant_id, user_id, email, role)
       VALUES ($1, $2, $3, 'owner')
       ON CONFLICT DO NOTHING
       RETURNING tenant_id`,
      [t.id, kcUserId, email],
    );
    if (inserted.rowCount) {
      console.log(`  → tenant_members ajouté`);
    } else {
      console.log(`  → tenant_members existait déjà`);
    }
  }

  console.log('\n✓ Seed Keycloak users terminé.');
  console.log('\nLogins disponibles (mot de passe identique : Maas2026!) :');
  for (const t of tenants.rows) {
    console.log(`  owner@${t.slug}.test`);
  }
  await matix.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
