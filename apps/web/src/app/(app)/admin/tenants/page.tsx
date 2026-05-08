'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, type Tenant } from '@/lib/api';

/**
 * Page admin plateforme — liste + provisioning de tenants.
 * Phase 0 : aucune auth (l'endpoint /admin/* est ouvert).
 * Phase 1 : à protéger par un check de role super-admin Matix dans la middleware.
 */
export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    setError(null);
    api.admin.tenants
      .list()
      .then(setTenants)
      .catch((e) => setError(e.message));
  };

  useEffect(reload, []);

  async function handleProvision(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    const f = e.currentTarget;
    const fd = new FormData(f);
    try {
      const result = await api.admin.tenants.provision({
        slug: String(fd.get('slug')).toLowerCase(),
        legal_name: String(fd.get('legal_name')),
        country_code: (fd.get('country_code') as string) || undefined,
        currency: (fd.get('currency') as string) || undefined,
        ninea: (fd.get('ninea') as string) || undefined,
        rc: (fd.get('rc') as string) || undefined,
        owner: {
          email: String(fd.get('owner_email')),
          first_name: String(fd.get('owner_first_name')),
          last_name: String(fd.get('owner_last_name')),
          password: String(fd.get('owner_password')),
        },
      });
      f.reset();
      setShowForm(false);
      setSuccess(result.message);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Administration — Tenants</h2>
          <p className="text-sm text-gray-500">
            ⚠️ Phase 0 : ces routes sont ouvertes en dev. À protéger par un guard super-admin Matix avant prod.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Annuler' : 'Nouveau tenant'}</Button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>}

      {showForm && (
        <form onSubmit={handleProvision} className="rounded-md border bg-white p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Tenant</h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input name="slug" placeholder="slug (ex: new-corp)" required pattern="[a-z][a-z0-9-]{1,40}[a-z0-9]" />
              <Input name="legal_name" placeholder="Raison sociale" required className="sm:col-span-2" />
              <Input name="country_code" placeholder="Pays (SN)" defaultValue="SN" maxLength={2} />
              <Input name="currency" placeholder="Devise (XOF)" defaultValue="XOF" maxLength={3} />
              <Input name="ninea" placeholder="NINEA (optionnel)" />
              <Input name="rc" placeholder="RC (optionnel)" />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
              Propriétaire (compte initial)
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input name="owner_email" type="email" placeholder="email" required />
              <Input name="owner_password" type="password" placeholder="mot de passe initial (8+ chars)" required minLength={8} />
              <Input name="owner_first_name" placeholder="Prénom" required />
              <Input name="owner_last_name" placeholder="Nom" required />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Création…' : 'Créer le tenant'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
              Annuler
            </Button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>Slug</Th>
              <Th>Raison sociale</Th>
              <Th>Statut</Th>
              <Th>Pays</Th>
              <Th>Devise</Th>
              <Th>Créé le</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tenants.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  Aucun tenant
                </td>
              </tr>
            )}
            {tenants.map((t) => (
              <tr key={t.id}>
                <Td className="font-mono">{t.slug}</Td>
                <Td>{t.legal_name}</Td>
                <Td><StatusBadge status={t.status} /></Td>
                <Td>{t.country_code}</Td>
                <Td>{t.currency}</Td>
                <Td className="text-gray-500">{new Date(t.created_at).toLocaleDateString('fr-FR')}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Tenant['status'] }) {
  const colors: Record<Tenant['status'], string> = {
    trial: 'bg-yellow-100 text-yellow-800',
    active: 'bg-green-100 text-green-800',
    suspended: 'bg-orange-100 text-orange-800',
    churned: 'bg-gray-100 text-gray-700',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors[status]}`}>{status}</span>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2 text-left font-medium text-gray-600 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2 ${className}`}>{children}</td>;
}
