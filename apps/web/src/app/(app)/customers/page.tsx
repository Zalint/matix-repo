'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, type Customer } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function CustomersPage() {
  const auth = useAuth();
  const [items, setItems] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = (q?: string) => {
    if (!auth.ready) return;
    setError(null);
    api.customers.list(auth, q).then(setItems).catch((e) => setError(e.message));
  };

  useEffect(() => reload(), [auth]);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!auth.ready) return;
    setBusy(true);
    setError(null);
    const f = e.currentTarget;
    const fd = new FormData(f);
    try {
      await api.customers.create(auth, {
        code: String(fd.get('code')),
        display_name: String(fd.get('display_name')),
        email: (fd.get('email') as string) || undefined,
        phone: (fd.get('phone') as string) || undefined,
        segment: (fd.get('segment') as string) || undefined,
      });
      f.reset();
      setShowForm(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!auth.ready) return;
    if (!confirm('Supprimer ce client ?')) return;
    try {
      await api.customers.remove(auth, id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!auth.ready) return <div className="text-sm text-gray-500">Chargement…</div>;

  const tenantLabel = auth.mode === 'dev' ? auth.tenantLabel : auth.userEmail ?? 'tenant';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Clients — {tenantLabel}</h2>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Annuler' : 'Nouveau client'}</Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Rechercher (nom, code, téléphone)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') reload(search);
          }}
          className="max-w-md"
        />
        <Button variant="secondary" onClick={() => reload(search)}>
          Rechercher
        </Button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {showForm && (
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 rounded-md border bg-white p-4 sm:grid-cols-3">
          <Input name="code" placeholder="Code (ex: CUST-001)" required />
          <Input name="display_name" placeholder="Nom" required className="sm:col-span-2" />
          <Input name="email" type="email" placeholder="Email (optionnel)" />
          <Input name="phone" placeholder="Téléphone (+221…)" />
          <Input name="segment" placeholder="Segment (individual, business…)" />
          <div className="sm:col-span-3">
            <Button type="submit" disabled={busy}>
              {busy ? 'Enregistrement…' : 'Créer'}
            </Button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>Code</Th>
              <Th>Nom</Th>
              <Th>Téléphone</Th>
              <Th>Segment</Th>
              <Th className="w-20"></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Aucun client
                </td>
              </tr>
            )}
            {items.map((c) => (
              <tr key={c.id}>
                <Td className="font-mono">{c.code}</Td>
                <Td>{c.display_name}</Td>
                <Td>{c.phone ?? '—'}</Td>
                <Td>{c.segment ?? '—'}</Td>
                <Td>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id)}>
                    Suppr.
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2 text-left font-medium text-gray-600 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2 ${className}`}>{children}</td>;
}
