'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, type ModuleDefinition, type TenantLicense, type Pillar } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const PILLAR_LABELS: Record<Pillar, string> = {
  platform: 'Plateforme',
  commercial: 'Commercial',
  operations: 'Opérations',
  finance: 'Finance',
  analytics: 'Analytique',
  marketplace: 'Marketplace',
};

const PILLAR_COLORS: Record<Pillar, string> = {
  platform: 'bg-gray-100 text-gray-700',
  commercial: 'bg-blue-100 text-blue-800',
  operations: 'bg-green-100 text-green-800',
  finance: 'bg-purple-100 text-purple-800',
  analytics: 'bg-orange-100 text-orange-800',
  marketplace: 'bg-pink-100 text-pink-800',
};

export default function LicensingPage() {
  const auth = useAuth();
  const [catalog, setCatalog] = useState<ModuleDefinition[]>([]);
  const [licenses, setLicenses] = useState<TenantLicense[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.licensing.catalog().then(setCatalog).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!auth.ready) return;
    api.licensing.me(auth).then(setLicenses).catch((e) => setError(e.message));
  }, [auth]);

  const licensedSet = useMemo(
    () => new Set(licenses.filter((l) => l.enabled).map((l) => l.module_code)),
    [licenses],
  );

  const grouped = useMemo(() => {
    const out: Record<Pillar, ModuleDefinition[]> = {
      platform: [], commercial: [], operations: [], finance: [], analytics: [], marketplace: [],
    };
    for (const m of catalog) out[m.pillar].push(m);
    return out;
  }, [catalog]);

  const counts = useMemo(() => {
    const enabled = licensedSet.size;
    const total = catalog.length;
    return { enabled, total };
  }, [licensedSet, catalog]);

  if (!auth.ready) return <div className="text-sm text-gray-500">Chargement…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Modules & Licences</h2>
        <p className="text-sm text-gray-500">
          Vue lecture seule des modules activés sur votre tenant. Pour activer/désactiver un module
          ou changer de plan, contactez Matix.
        </p>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Modules activés" value={counts.enabled} />
        <Stat label="Modules au catalogue" value={counts.total} />
        <Stat
          label="Sources de licence"
          value={`${licenses.filter((l) => l.source === 'plan').length} plan · ${licenses.filter((l) => l.source === 'manual').length} manuel`}
        />
      </div>

      {(['platform', 'commercial', 'operations', 'finance', 'analytics'] as Pillar[]).map((pillar) => (
        <div key={pillar}>
          <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold">
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PILLAR_COLORS[pillar]}`}>
              {PILLAR_LABELS[pillar]}
            </span>
            <span className="text-sm font-normal text-gray-500">
              ({grouped[pillar].filter((m) => licensedSet.has(m.code)).length} / {grouped[pillar].length} activés)
            </span>
          </h3>
          <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <Th className="w-[260px]">Code</Th>
                  <Th>Module</Th>
                  <Th className="w-32">Statut</Th>
                  <Th className="w-32">Licence</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {grouped[pillar].map((m) => {
                  const lic = licenses.find((l) => l.module_code === m.code);
                  const enabled = lic?.enabled === true;
                  return (
                    <tr key={m.code} className={enabled ? '' : 'opacity-60'}>
                      <Td className="font-mono text-xs">{m.code}</Td>
                      <Td>
                        <div className="font-medium">{m.label.fr}</div>
                        {m.description_fr && (
                          <div className="text-xs text-gray-500">{m.description_fr}</div>
                        )}
                      </Td>
                      <Td>
                        <ModuleStatusBadge status={m.status} />
                      </Td>
                      <Td>
                        {enabled ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-green-500" />
                            <span className="text-xs">Activé{lic?.source === 'manual' ? ' (manuel)' : ''}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
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

function ModuleStatusBadge({ status }: { status: ModuleDefinition['status'] }) {
  const colors: Record<ModuleDefinition['status'], string> = {
    active: 'bg-green-100 text-green-800',
    beta: 'bg-yellow-100 text-yellow-800',
    'coming-soon': 'bg-gray-100 text-gray-600',
  };
  const labels: Record<ModuleDefinition['status'], string> = {
    active: 'Actif',
    beta: 'Bêta',
    'coming-soon': 'À venir',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors[status]}`}>
      {labels[status]}
    </span>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2 text-left font-medium text-gray-600 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2 align-top ${className}`}>{children}</td>;
}
