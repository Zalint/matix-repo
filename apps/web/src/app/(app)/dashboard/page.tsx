'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function DashboardPage() {
  const auth = useAuth();
  const [counts, setCounts] = useState<{ products: number; customers: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.ready) return;
    setError(null);
    Promise.all([api.products.list(auth), api.customers.list(auth)])
      .then(([p, c]) => setCounts({ products: p.length, customers: c.length }))
      .catch((e) => setError(e.message));
  }, [auth]);

  if (!auth.ready) return <div className="text-sm text-gray-500">Chargement…</div>;

  const tenantLabel =
    auth.mode === 'dev' ? auth.tenantLabel : auth.userEmail ?? auth.tenantId.slice(0, 8);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Tableau de bord</h2>
        <p className="text-sm text-gray-500">
          Connecté en tant que <span className="font-medium">{tenantLabel}</span> — mode{' '}
          <span className="font-mono text-xs">{auth.mode}</span>
        </p>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Produits" value={counts?.products ?? '—'} />
        <Stat label="Clients" value={counts?.customers ?? '—'} />
        <Stat label="Modules actifs" value={2} />
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-700">
        <p className="font-medium">Mode {auth.mode === 'keycloak' ? 'production' : 'développement'}</p>
        <p className="mt-1 text-gray-500">
          {auth.mode === 'keycloak'
            ? 'Authentification réelle via Keycloak (OIDC). Le tenant courant vient de la claim JWT.'
            : 'Auth simulée via headers X-Dev-Tenant-Id. Bascule de tenant via le dropdown en haut à droite.'}
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
