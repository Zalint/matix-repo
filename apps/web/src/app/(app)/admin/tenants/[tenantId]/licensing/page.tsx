'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  api,
  type ModuleDefinition,
  type Plan,
  type TenantLicense,
  type Pillar,
} from '@/lib/api';
import { useToast } from '@/components/ui/toast';

const PILLAR_LABELS: Record<Pillar, string> = {
  platform: 'Plateforme',
  commercial: 'Commercial',
  operations: 'Opérations',
  finance: 'Finance',
  analytics: 'Analytique',
  marketplace: 'Marketplace',
};

export default function AdminTenantLicensingPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  const toast = useToast();

  const [catalog, setCatalog] = useState<ModuleDefinition[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [licenses, setLicenses] = useState<TenantLicense[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    api.adminLicensing
      .listForTenant(tenantId)
      .then(setLicenses)
      .catch((e) => toast.error(e.message ?? String(e), { title: 'Chargement licences' }));
  };

  useEffect(() => {
    api.licensing
      .catalog()
      .then(setCatalog)
      .catch((e) => toast.error(e.message ?? String(e), { title: 'Catalogue' }));
    api.licensing
      .plans()
      .then(setPlans)
      .catch((e) => toast.error(e.message ?? String(e), { title: 'Plans' }));
    reload();
  }, [tenantId]);

  const licenseMap = useMemo(
    () => new Map(licenses.map((l) => [l.module_code, l])),
    [licenses],
  );

  async function handleAssignPlan(planCode: string) {
    const ok = await toast.confirm({
      title: `Assigner le plan "${planCode}" ?`,
      message: "Cela rematerialise les licences source='plan'.",
      confirmLabel: 'Assigner',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.adminLicensing.assignPlan(tenantId, planCode);
      toast.success(`Plan "${planCode}" assigne.`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { title: 'Assignation' });
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleModule(moduleCode: string, currentEnabled: boolean) {
    try {
      await api.adminLicensing.toggleModule(tenantId, moduleCode, !currentEnabled);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { title: 'Module' });
    }
  }

  const grouped = useMemo(() => {
    const out: Record<Pillar, ModuleDefinition[]> = {
      platform: [], commercial: [], operations: [], finance: [], analytics: [], marketplace: [],
    };
    for (const m of catalog) out[m.pillar].push(m);
    return out;
  }, [catalog]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/tenants" className="text-sm text-gray-500 hover:text-gray-700">
          ← Tenants
        </Link>
      </div>

      <div>
        <h2 className="text-2xl font-semibold">Licences du tenant</h2>
        <p className="text-sm text-gray-500 font-mono">{tenantId}</p>
      </div>

      {/* Plans */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Plans</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {plans.map((p) => (
            <div key={p.code} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-sm font-semibold">{p.name}</div>
              <div className="mt-1 text-xs text-gray-500">
                {Number(p.monthly_price_xof).toLocaleString('fr-FR')} XOF/mois
              </div>
              <div className="mt-1 text-xs text-gray-400">{p.modules.length} modules</div>
              <Button
                size="sm"
                variant="primary"
                className="mt-3 w-full"
                disabled={busy}
                onClick={() => handleAssignPlan(p.code)}
              >
                Assigner
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Modules par pilier */}
      {(['platform', 'commercial', 'operations', 'finance', 'analytics'] as Pillar[]).map((pillar) => (
        <section key={pillar}>
          <h3 className="mb-2 text-lg font-semibold">{PILLAR_LABELS[pillar]}</h3>
          <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <Th>Module</Th>
                  <Th className="w-32">Source</Th>
                  <Th className="w-32">Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {grouped[pillar].map((m) => {
                  const lic = licenseMap.get(m.code);
                  const enabled = lic?.enabled === true;
                  return (
                    <tr key={m.code} className={enabled ? '' : 'opacity-50'}>
                      <Td>
                        <div className="font-medium">{m.label.fr}</div>
                        <div className="font-mono text-[10px] text-gray-400">{m.code}</div>
                      </Td>
                      <Td>
                        {lic ? (
                          <span className="text-xs">
                            <span className="font-medium">{lic.source}</span>
                            {!lic.enabled && <span className="text-red-500"> · désactivé</span>}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">aucune</span>
                        )}
                      </Td>
                      <Td>
                        <Button
                          size="sm"
                          variant={enabled ? 'danger' : 'secondary'}
                          onClick={() => handleToggleModule(m.code, enabled)}
                        >
                          {enabled ? 'Désactiver' : 'Activer'}
                        </Button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2 text-left font-medium text-gray-600 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2 align-top ${className}`}>{children}</td>;
}
