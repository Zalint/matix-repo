'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ROLE_LABELS, type TeamMember, type TenantRole } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const ALL_ROLES: TenantRole[] = ['owner', 'admin', 'superviseur', 'member', 'readonly'];
const ROLE_LEVELS: Record<TenantRole, number> = {
  owner: 5, admin: 4, superviseur: 3, member: 2, readonly: 1,
};

export default function TeamPage() {
  const auth = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  // Mode dev en local : on assume 'owner'. Mode keycloak : on lit le rôle dans la session.
  const myRole: TenantRole | null = useMemo(() => {
    if (!auth.ready) return null;
    if (auth.mode === 'dev') return 'owner';
    // En keycloak mode, on doit lire `role` depuis la session — pour l'instant on assume
    // que tout user authentifié peut au moins voir la liste. La page est gated côté API
    // avec un message clair si insuffisant.
    return 'owner'; // TODO: passer le rôle depuis le JWT côté frontend
  }, [auth]);

  const canCreate = myRole && ROLE_LEVELS[myRole] >= ROLE_LEVELS.admin;
  const canChangeRole = myRole === 'owner';
  const canDelete = myRole && ROLE_LEVELS[myRole] >= ROLE_LEVELS.admin;

  const reload = () => {
    if (!auth.ready) return;
    setError(null);
    api.team.list(auth).then(setMembers).catch((e) => setError(e.message));
  };

  useEffect(reload, [auth]);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!auth.ready) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const f = e.currentTarget;
    const fd = new FormData(f);
    try {
      const created = await api.team.create(auth, {
        email: String(fd.get('email')),
        first_name: String(fd.get('first_name')),
        last_name: String(fd.get('last_name')),
        password: String(fd.get('password')),
        role: fd.get('role') as TenantRole,
      });
      f.reset();
      setShowForm(false);
      setSuccess(`Membre ${created.email} ajouté avec le rôle ${ROLE_LABELS[created.role]}.`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleChangeRole(userId: string, newRole: TenantRole) {
    if (!auth.ready) return;
    setError(null);
    try {
      await api.team.updateRole(auth, userId, newRole);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemove(userId: string, email: string) {
    if (!auth.ready) return;
    if (!confirm(`Retirer ${email} du tenant ?`)) return;
    setError(null);
    try {
      await api.team.remove(auth, userId);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!auth.ready) return <div className="text-sm text-gray-500">Chargement…</div>;

  const visible = members.filter((m) => !m.deactivated_at);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Équipe</h2>
          <p className="text-sm text-gray-500">Gérez les utilisateurs de votre organisation.</p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Annuler' : 'Inviter un membre'}
          </Button>
        )}
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>}

      {showForm && canCreate && (
        <form onSubmit={handleCreate} className="rounded-md border bg-white p-5 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input name="email" type="email" placeholder="email@exemple.com" required />
            <select
              name="role"
              defaultValue="member"
              className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              required
            >
              {ALL_ROLES.map((r) => (
                <option key={r} value={r} disabled={myRole !== 'owner' && r === 'owner'}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <Input name="first_name" placeholder="Prénom" required />
            <Input name="last_name" placeholder="Nom" required />
            <Input name="password" type="password" placeholder="Mot de passe initial (8+ chars)" required minLength={8} className="sm:col-span-2" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Création…' : 'Créer le membre'}</Button>
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Annuler</Button>
          </div>
          <p className="text-xs text-gray-500">
            Le membre pourra se connecter immédiatement avec ce mot de passe. Communique-le-lui de
            manière sécurisée. (En Phase 2, ce sera remplacé par un email d'invitation.)
          </p>
        </form>
      )}

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>Email</Th>
              <Th>Rôle</Th>
              <Th>Ajouté le</Th>
              <Th className="w-32"></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">Aucun membre</td>
              </tr>
            )}
            {visible.map((m) => (
              <tr key={m.user_id}>
                <Td>{m.email}</Td>
                <Td>
                  {canChangeRole ? (
                    <select
                      value={m.role}
                      onChange={(e) => handleChangeRole(m.user_id, e.target.value as TenantRole)}
                      className="h-8 rounded border border-gray-300 bg-white px-2 text-xs"
                    >
                      {ALL_ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  ) : (
                    <RoleBadge role={m.role} />
                  )}
                </Td>
                <Td className="text-gray-500">{new Date(m.created_at).toLocaleDateString('fr-FR')}</Td>
                <Td>
                  {canDelete && (
                    <Button size="sm" variant="ghost" onClick={() => handleRemove(m.user_id, m.email)}>
                      Retirer
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: TenantRole }) {
  const colors: Record<TenantRole, string> = {
    owner: 'bg-purple-100 text-purple-800',
    admin: 'bg-blue-100 text-blue-800',
    superviseur: 'bg-indigo-100 text-indigo-700',
    member: 'bg-gray-100 text-gray-700',
    readonly: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors[role]}`}>
      {ROLE_LABELS[role]}
    </span>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2 text-left font-medium text-gray-600 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2 ${className}`}>{children}</td>;
}
