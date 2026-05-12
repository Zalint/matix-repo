'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageSpinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import {
  api,
  type Cutting,
  type PointOfSale,
  type Product,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { NewCuttingDrawer } from './_components/new-cutting-drawer';

/**
 * /operations/inventory/cuttings — vue jour des découpes.
 *
 * - Filtres date + PV + produit source
 * - 4 KPI (nb découpes, source totale, sorties, chute totale en kg et %)
 * - Tableau des découpes avec sorties détaillées + rendement
 * - Bouton "+ Nouvelle découpe" ouvre un drawer (composant séparé)
 */
export default function CuttingsListPage() {
  const auth = useAuth();
  const toast = useToast();

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [pos, setPos] = useState<PointOfSale[]>([]);
  const [posId, setPosId] = useState<string>('');
  const [products, setProducts] = useState<Product[]>([]);
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [rows, setRows] = useState<Cutting[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Map produits pour afficher les noms dans les sorties
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  useEffect(() => {
    if (!auth.ready) return;
    Promise.all([
      api.pointsOfSale.list(auth, { activeOnly: true }),
      api.products.list(auth),
    ])
      .then(([ps, prods]) => {
        setPos(ps);
        setProducts(prods);
        if (ps.length > 0 && !posId) setPosId(ps[0].id);
      })
      .catch((e) => toast.error(String(e), { title: 'Chargement' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready]);

  useEffect(() => {
    if (!auth.ready || !posId) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready, date, posId, sourceFilter]);

  async function reload() {
    if (!auth.ready || !posId) return;
    try {
      const list = await api.inventory.cuttings.list(auth, {
        date,
        point_of_sale_id: posId,
        source_product_id: sourceFilter || undefined,
      });
      setRows(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { title: 'Découpes' });
    }
  }

  // KPI agrégés
  const stats = useMemo(() => {
    const sourceTotal = rows.reduce((s, r) => s + r.source_quantity, 0);
    const outputsTotal = rows.reduce((s, r) => s + r.total_outputs, 0);
    const wasteTotal = rows.reduce((s, r) => s + r.waste_quantity, 0);
    const wastePct = sourceTotal > 0 ? (wasteTotal / sourceTotal) * 100 : 0;
    return {
      count: rows.length,
      sourceTotal,
      outputsTotal,
      wasteTotal,
      wastePct,
    };
  }, [rows]);

  function exportCsv() {
    const header = [
      'Heure',
      'Source',
      'Qté source (kg)',
      'Sorties',
      'Total sorties (kg)',
      'Chute (kg)',
      'Chute (%)',
      'Notes',
    ];
    const lines = [header.join(';')];
    for (const r of rows) {
      const sourceP = productMap.get(r.source_product_id);
      const outputs = r.outputs
        .map((o) => {
          const p = productMap.get(o.product_id);
          return `${o.quantity} ${p?.name ?? o.product_id}`;
        })
        .join(' | ');
      lines.push(
        [
          new Date(r.performed_at).toLocaleTimeString('fr-FR'),
          quote(sourceP?.name ?? r.source_product_id),
          r.source_quantity,
          quote(outputs),
          r.total_outputs,
          r.waste_quantity,
          r.waste_pct,
          quote(r.notes ?? ''),
        ].join(';'),
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decoupes-${date}-${posId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!auth.ready) return <PageSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Découpes</h2>
          <p className="text-sm text-gray-500">
            Carcasses et matières premières transformées en produits finis. Une découpe = 1 source → N sorties + chute (os, gras, perte).
          </p>
        </div>
        <Button onClick={() => setDrawerOpen(true)} disabled={!posId}>
          + Nouvelle découpe
        </Button>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-gray-200 bg-white p-3">
        <div>
          <label className="block text-xs font-medium text-gray-600">Date</label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Point de vente</label>
          <select
            value={posId}
            onChange={(e) => setPosId(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm"
          >
            {pos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Produit source</label>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm"
          >
            <option value="">Tous</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto">
          <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
            Export CSV
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Découpes" value={String(stats.count)} />
        <Kpi label="Source totale" value={`${fmt(stats.sourceTotal)} kg`} />
        <Kpi label="Sorties (produits finis)" value={`${fmt(stats.outputsTotal)} kg`} />
        <Kpi
          label="Chute totale"
          value={`${fmt(stats.wasteTotal)} kg · ${stats.wastePct.toFixed(1)} %`}
          tone={stats.wastePct > 25 ? 'warn' : 'normal'}
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <Th>Heure</Th>
              <Th>Source</Th>
              <Th className="text-right">Qté source</Th>
              <Th>Sorties</Th>
              <Th className="text-right">Total sorties</Th>
              <Th className="text-right">Chute</Th>
              <Th>Rendement</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  Aucune découpe sur cette date / PV
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const sourceP = productMap.get(r.source_product_id);
              const yieldPct = r.source_quantity > 0
                ? ((r.total_outputs / r.source_quantity) * 100).toFixed(1)
                : '—';
              return (
                <tr key={r.id}>
                  <Td className="tabular-nums whitespace-nowrap">
                    {new Date(r.performed_at).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Td>
                  <Td>
                    <div className="font-medium">{sourceP?.name ?? r.source_product_id}</div>
                    {sourceP && <div className="text-[11px] text-gray-500">{sourceP.sku}</div>}
                  </Td>
                  <Td className="text-right tabular-nums">{fmt(r.source_quantity)} kg</Td>
                  <Td>
                    <div className="space-y-0.5 text-xs">
                      {r.outputs.map((o) => {
                        const p = productMap.get(o.product_id);
                        return (
                          <div key={o.id}>
                            {fmt(o.quantity)} kg · <b>{p?.name ?? o.product_id}</b>
                          </div>
                        );
                      })}
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums">{fmt(r.total_outputs)} kg</Td>
                  <Td className="text-right">
                    <div className="tabular-nums text-amber-900">{fmt(r.waste_quantity)} kg</div>
                    <div className="text-[11px] text-amber-800">{r.waste_pct.toFixed(1)} %</div>
                  </Td>
                  <Td className="text-xs tabular-nums">{yieldPct} %</Td>
                  <Td className="text-xs text-gray-600 max-w-[220px] truncate" title={r.notes ?? ''}>
                    {r.notes ?? ''}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {drawerOpen && (
        <NewCuttingDrawer
          posId={posId}
          products={products}
          onClose={() => setDrawerOpen(false)}
          onSaved={() => {
            setDrawerOpen(false);
            void reload();
            toast.success('Découpe enregistrée.');
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function Kpi({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'warn';
}) {
  const cls = tone === 'warn'
    ? 'border-amber-300 bg-amber-50'
    : 'border-gray-200 bg-white';
  return (
    <div className={`rounded-md border ${cls} p-3`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 font-medium text-gray-600 ${className}`}>{children}</th>
  );
}

function Td({
  children,
  className = '',
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td className={`px-3 py-2 align-top ${className}`} title={title}>
      {children}
    </td>
  );
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) < 0.001) return '0';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

function quote(s: string): string {
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
