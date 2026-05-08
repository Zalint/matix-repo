'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useTenant } from '@/lib/tenant-context';

export default function DashboardPage() {
  const { current, ready } = useTenant();
  const [counts, setCounts] = useState<{ products: number; customers: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    setError(null);
    Promise.all([api.products.list(current), api.customers.list(current)])
      .then(([p, c]) => setCounts({ products: p.length, customers: c.length }))
      .catch((e) => setError(e.message));
  }, [current, ready]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Tableau de bord</h2>
        <p className="text-sm text-gray-500">Tenant courant : {current.label}</p>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Produits" value={counts?.products ?? '—'} />
        <Stat label="Clients" value={counts?.customers ?? '—'} />
        <Stat label="Modules actifs" value={2} />
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-700">
        <p className="font-medium">Mode développement</p>
        <p className="mt-1 text-gray-500">
          L'auth est simulée via les headers <code className="rounded bg-gray-100 px-1">X-Dev-Tenant-Id</code> /{' '}
          <code className="rounded bg-gray-100 px-1">X-Dev-User-Id</code>. Change de tenant en haut à droite et observe
          que les listes Produits / Clients sont cloisonnées par RLS Postgres.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
