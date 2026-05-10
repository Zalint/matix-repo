'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import {
  api,
  type DailyClosingView,
  type PointOfSale,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/**
 * /operations/reconciliation — vue d'ensemble post-saisie.
 *
 * Pour une (date, PV), on affiche :
 *   - 1 KPI bandeau (saisis / theoriques / ecart total / pourcentage)
 *   - Tableau des ecarts non nuls, tries par |ecart| desc
 *   - Note du jour (lecture seule depuis ici, edit cote /daily)
 *   - Export CSV des ecarts uniquement
 *
 * Les saisies se font sur la page /operations/inventory/daily ; cette page
 * est le "tableau de bord" qui aide a comprendre les ecarts avant cloture.
 */
export default function ReconciliationPage() {
  const auth = useAuth();
  const toast = useToast();

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [pos, setPos] = useState<PointOfSale[]>([]);
  const [posId, setPosId] = useState<string>('');
  const [rows, setRows] = useState<DailyClosingView[]>([]);
  const [note, setNote] = useState<string>('');

  // Charger les PV au mount
  useEffect(() => {
    if (!auth.ready) return;
    api.pointsOfSale
      .list(auth, { activeOnly: true })
      .then((items) => {
        setPos(items);
        if (items.length > 0 && !posId) setPosId(items[0].id);
      })
      .catch((e) => toast.error(String(e), { title: 'PV' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready]);

  useEffect(() => {
    if (!auth.ready || !posId) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready, date, posId]);

  async function reload() {
    if (!auth.ready || !posId) return;
    try {
      const [list, n] = await Promise.all([
        api.inventory.dailyClosing.list(auth, {
          date,
          point_of_sale_id: posId,
        }),
        api.inventory.dailyClosing.getNote(auth, {
          date,
          point_of_sale_id: posId,
        }),
      ]);
      setRows(list);
      setNote(n?.body ?? '');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), {
        title: 'Chargement',
      });
    }
  }

  // KPI : saisis vs total, ecart total, top ecarts
  const stats = useMemo(() => {
    let total = rows.length;
    let saisi = 0;
    let pending = 0;
    let ecartTotalAbs = 0;
    let ecartTotalSigned = 0;
    let theoriqueTotal = 0;
    const ecarts: Array<{ row: DailyClosingView; ecart: number }> = [];

    for (const r of rows) {
      theoriqueTotal += r.figures.stock_theorique;
      if (!r.closing) {
        if (r.product.stock_mode === 'manuel') pending++;
        continue;
      }
      saisi++;
      const e = r.closing.quantity - r.figures.stock_theorique;
      ecartTotalAbs += Math.abs(e);
      ecartTotalSigned += e;
      if (Math.abs(e) > 0.001) ecarts.push({ row: r, ecart: e });
    }
    ecarts.sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart));
    const ecartPct =
      theoriqueTotal > 0 ? (ecartTotalAbs / theoriqueTotal) * 100 : 0;
    return {
      total,
      saisi,
      pending,
      ecartTotalAbs,
      ecartTotalSigned,
      theoriqueTotal,
      ecartPct,
      ecarts,
    };
  }, [rows]);

  function exportEcartsCsv() {
    const header = [
      'Produit',
      'SKU',
      'Famille',
      'Mode',
      'Theorique',
      'Stock soir',
      'Source',
      'Ecart',
      '% ecart',
    ];
    const csv = [header.join(';')];
    for (const { row, ecart } of stats.ecarts) {
      const closing = row.closing?.quantity ?? 0;
      const pct =
        row.figures.stock_theorique > 0
          ? (ecart / row.figures.stock_theorique) * 100
          : 0;
      csv.push(
        [
          quote(row.product.name),
          quote(row.product.sku),
          quote(row.product.category_family ?? ''),
          row.product.stock_mode,
          row.figures.stock_theorique,
          closing,
          row.closing?.source ?? '',
          ecart,
          pct.toFixed(2),
        ].join(';'),
      );
    }
    const blob = new Blob([csv.join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation-${date}-${posId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!auth.ready) return <div className="text-sm text-gray-500">Chargement…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Reconciliation</h2>
        <p className="text-sm text-gray-500">
          Comparaison stock soir saisi/calcule vs stock theorique. Saisie sur la
          page{' '}
          <Link
            href="/operations/inventory/daily"
            className="text-brand-700 hover:underline"
          >
            Stock soir (saisie)
          </Link>
          .
        </p>
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
          <label className="block text-xs font-medium text-gray-600">
            Point de vente
          </label>
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
        <div className="ml-auto flex gap-2">
          <Button
            variant="secondary"
            onClick={exportEcartsCsv}
            disabled={stats.ecarts.length === 0}
          >
            Export CSV ({stats.ecarts.length})
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          label="Saisis"
          value={`${stats.saisi}/${stats.total}`}
          tone={stats.pending === 0 ? 'good' : 'warn'}
        />
        <Kpi
          label="Manuels en attente"
          value={String(stats.pending)}
          tone={stats.pending === 0 ? 'good' : 'warn'}
        />
        <Kpi
          label="Ecart total (abs)"
          value={fmt(stats.ecartTotalAbs)}
          tone={stats.ecartTotalAbs < 1 ? 'good' : 'warn'}
        />
        <Kpi
          label="Ecart / theorique"
          value={`${stats.ecartPct.toFixed(2)} %`}
          tone={stats.ecartPct < 1 ? 'good' : stats.ecartPct < 5 ? 'warn' : 'bad'}
        />
      </div>

      {/* Note */}
      {note && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-amber-700">
            Note du jour
          </div>
          <p className="mt-1 whitespace-pre-wrap text-gray-800">{note}</p>
        </div>
      )}

      {/* Ecarts */}
      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>Produit</Th>
              <Th>Mode</Th>
              <Th className="text-right">Theorique</Th>
              <Th className="text-right">Stock soir</Th>
              <Th className="text-right">Ecart</Th>
              <Th className="text-right">% ecart</Th>
              <Th>Source</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {stats.ecarts.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-gray-400"
                >
                  Aucun ecart sur cette date / PV
                </td>
              </tr>
            )}
            {stats.ecarts.map(({ row, ecart }) => {
              const closing = row.closing?.quantity ?? 0;
              const pct =
                row.figures.stock_theorique > 0
                  ? (ecart / row.figures.stock_theorique) * 100
                  : 0;
              return (
                <tr key={row.product.id}>
                  <Td>
                    <div className="font-medium">{row.product.name}</div>
                    <div className="text-[11px] text-gray-500">
                      {row.product.sku}
                      {row.product.category_family
                        ? ` · ${row.product.category_family}`
                        : ''}
                    </div>
                  </Td>
                  <Td>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        row.product.stock_mode === 'manuel'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {row.product.stock_mode}
                    </span>
                  </Td>
                  <Td className="text-right tabular-nums text-gray-500">
                    {fmt(row.figures.stock_theorique)}
                  </Td>
                  <Td className="text-right tabular-nums">{fmt(closing)}</Td>
                  <Td
                    className={`text-right tabular-nums font-medium ${
                      ecart > 0 ? 'text-green-700' : 'text-red-700'
                    }`}
                  >
                    {ecart > 0 ? '+' : ''}
                    {fmt(ecart)}
                  </Td>
                  <Td
                    className={`text-right tabular-nums ${
                      Math.abs(pct) >= 5
                        ? 'text-red-700'
                        : Math.abs(pct) >= 1
                          ? 'text-amber-700'
                          : 'text-gray-500'
                    }`}
                  >
                    {pct > 0 ? '+' : ''}
                    {pct.toFixed(1)} %
                  </Td>
                  <Td>
                    {row.closing && (
                      <span
                        className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          row.closing.source === 'manual'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {row.closing.source === 'manual' ? 'saisie' : 'auto'}
                      </span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'bad';
}) {
  const colors: Record<typeof tone, string> = {
    good: 'border-green-200 bg-green-50 text-green-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    bad: 'border-red-200 bg-red-50 text-red-900',
  };
  return (
    <div className={`rounded-md border p-3 ${colors[tone]}`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-3 py-2 text-left font-medium text-gray-600 ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 align-middle ${className}`}>{children}</td>;
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
