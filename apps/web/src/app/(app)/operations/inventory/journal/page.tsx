'use client';

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import {
  api,
  type MovementType,
  type PointOfSale,
  type Product,
  type StockMovement,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const TYPE_LABELS: Record<MovementType, string> = {
  opening: 'Ouverture',
  closing: 'Clôture',
  sale: 'Vente',
  return: 'Retour',
  adjustment: 'Ajustement',
  transfer_in: 'Transfert in',
  transfer_out: 'Transfert out',
  cutting_in: 'Découpe in',
  cutting_out: 'Découpe out',
};

const TYPE_COLORS: Record<MovementType, string> = {
  opening: 'bg-blue-100 text-blue-800',
  closing: 'bg-purple-100 text-purple-800',
  sale: 'bg-green-100 text-green-800',
  return: 'bg-orange-100 text-orange-800',
  adjustment: 'bg-yellow-100 text-yellow-800',
  transfer_in: 'bg-cyan-100 text-cyan-800',
  transfer_out: 'bg-pink-100 text-pink-800',
  cutting_in: 'bg-emerald-100 text-emerald-800',
  cutting_out: 'bg-rose-100 text-rose-800',
};

const ALL_TYPES: MovementType[] = [
  'opening', 'closing', 'sale', 'return', 'adjustment',
  'transfer_in', 'transfer_out', 'cutting_in', 'cutting_out',
];

/**
 * /operations/inventory/journal — Journal des mouvements de stock (audit).
 *
 * Vue read-only, append-only. Filtre par date, PV, produit, type. Sert au
 * débogage et à la traçabilité — on retrouve qui a fait quoi quand.
 *
 * Pagination simple côté client : on charge les 500 derniers et on filtre
 * en mémoire. Au-delà, ajouter offset+limit côté backend (déjà supporté).
 */
export default function JournalPage() {
  const auth = useAuth();
  const toast = useToast();

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [pos, setPos] = useState<PointOfSale[]>([]);
  const [posId, setPosId] = useState<string>('');
  const [products, setProducts] = useState<Product[]>([]);
  const [productFilter, setProductFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<MovementType | ''>('');
  const [movements, setMovements] = useState<StockMovement[]>([]);

  useEffect(() => {
    if (!auth.ready) return;
    Promise.all([
      api.pointsOfSale.list(auth, { activeOnly: true }),
      api.products.list(auth),
    ])
      .then(([ps, prods]) => {
        setPos(ps);
        setProducts(prods);
      })
      .catch((e) => toast.error(String(e), { title: 'Chargement' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready]);

  useEffect(() => {
    if (!auth.ready) return;
    const opts: Parameters<typeof api.inventory.movements>[1] = { limit: 500 };
    if (posId) opts.point_of_sale_id = posId;
    if (productFilter) opts.product_id = productFilter;
    api.inventory.movements(auth, opts).then(setMovements).catch((e) => toast.error(String(e), { title: 'Journal' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready, posId, productFilter]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const posMap = useMemo(() => new Map(pos.map((p) => [p.id, p])), [pos]);

  const filtered = useMemo(() => {
    return movements
      .filter((m) => m.performed_at.slice(0, 10) === date)
      .filter((m) => !typeFilter || m.movement_type === typeFilter);
  }, [movements, date, typeFilter]);

  function exportCsv() {
    const header = ['Date', 'Heure', 'Type', 'Produit', 'SKU', 'Point de vente', 'Quantité', 'Référence', 'Motif'];
    const lines = [header.join(';')];
    for (const m of filtered) {
      const prod = productMap.get(m.product_id);
      const posInfo = posMap.get(m.point_of_sale_id);
      const dt = new Date(m.performed_at);
      lines.push([
        dt.toLocaleDateString('fr-FR'),
        dt.toLocaleTimeString('fr-FR'),
        TYPE_LABELS[m.movement_type],
        quote(prod?.name ?? m.product_id),
        quote(prod?.sku ?? ''),
        quote(posInfo?.name ?? m.point_of_sale_id),
        m.quantity,
        quote(m.reference_table ?? ''),
        quote(m.reason ?? ''),
      ].join(';'));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal-stock-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!auth.ready) return <div className="text-sm text-gray-500">Chargement…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Journal des mouvements</h2>
        <p className="text-sm text-gray-500">
          Toutes les écritures de stock (ouvertures, ventes, transferts, découpes, ajustements).
          Append-only — sert à la traçabilité et au débogage.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-gray-200 bg-white p-3">
        <div>
          <label className="block text-xs font-medium text-gray-600">Date</label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Point de vente</label>
          <select
            value={posId}
            onChange={(e) => setPosId(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm"
          >
            <option value="">Tous</option>
            {pos.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Produit</label>
          <select
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm"
          >
            <option value="">Tous</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Type</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as MovementType | '')}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm"
          >
            <option value="">Tous</option>
            {ALL_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-500">{filtered.length} ligne(s)</span>
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium hover:bg-gray-100 disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>Date/Heure</Th>
              <Th>Type</Th>
              <Th>Produit</Th>
              <Th>Point de vente</Th>
              <Th className="text-right">Quantité</Th>
              <Th>Référence</Th>
              <Th>Motif</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucun mouvement</td>
              </tr>
            )}
            {filtered.map((m) => {
              const prod = productMap.get(m.product_id);
              const posInfo = posMap.get(m.point_of_sale_id);
              const q = Number(m.quantity);
              return (
                <tr key={m.id}>
                  <Td className="text-xs whitespace-nowrap text-gray-600">
                    {new Date(m.performed_at).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </Td>
                  <Td>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${TYPE_COLORS[m.movement_type]}`}>
                      {TYPE_LABELS[m.movement_type]}
                    </span>
                  </Td>
                  <Td className="text-xs">
                    {prod?.name ?? m.product_id.slice(0, 8)}
                    {prod && <span className="text-gray-400 ml-1">({prod.sku})</span>}
                  </Td>
                  <Td className="text-xs">{posInfo?.name ?? m.point_of_sale_id.slice(0, 8)}</Td>
                  <Td className={`text-right font-mono ${q < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {q > 0 ? '+' : ''}{q.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}
                  </Td>
                  <Td className="text-[11px] text-gray-500">
                    {m.reference_table ?? '—'}
                    {m.reference_id && <div className="font-mono text-[10px]">{m.reference_id.slice(0, 8)}</div>}
                  </Td>
                  <Td className="text-xs text-gray-600 max-w-[260px] truncate" title={m.reason ?? ''}>
                    {m.reason ?? '—'}
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

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2 text-left font-medium text-gray-600 ${className}`}>{children}</th>;
}
function Td({ children, className = '', title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <td className={`px-4 py-2 ${className}`} title={title}>{children}</td>;
}

function quote(s: string): string {
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
