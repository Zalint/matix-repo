'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/ui/toast';
import {
  api,
  type PointOfSale,
  type Product,
  type StockLevel,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/**
 * /operations/inventory — Niveaux de stock courants.
 *
 * Vue cache mise à jour automatiquement à chaque mouvement. Affiche
 * quantity_on_hand par (produit, PV). Pas de saisie ici — les saisies se
 * font sur les pages dédiées : Stock matin (auto-cron), Transferts,
 * Découpes, Stock soir.
 *
 * Page de consultation pure, utile pour vérifier "qu'est-ce qu'il me reste
 * en stock à tel PV".
 */
export default function StockLevelsPage() {
  const auth = useAuth();
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [pos, setPos] = useState<PointOfSale[]>([]);
  const [levels, setLevels] = useState<StockLevel[]>([]);
  const [posId, setPosId] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  useEffect(() => {
    if (!auth.ready) return;
    Promise.all([
      api.products.list(auth),
      api.pointsOfSale.list(auth, { activeOnly: true }),
    ])
      .then(([p, ps]) => {
        setProducts(p);
        setPos(ps);
      })
      .catch((e) => toast.error(String(e), { title: 'Chargement' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready]);

  useEffect(() => {
    if (!auth.ready) return;
    const opts = posId ? { point_of_sale_id: posId } : undefined;
    api.inventory
      .levels(auth, opts)
      .then(setLevels)
      .catch((e) => toast.error(String(e), { title: 'Niveaux' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready, posId]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const posMap = useMemo(() => new Map(pos.map((p) => [p.id, p])), [pos]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return levels
      .map((lv) => {
        const prod = productMap.get(lv.product_id);
        const posInfo = posMap.get(lv.point_of_sale_id);
        return {
          ...lv,
          productName: prod?.name ?? lv.product_id.slice(0, 8),
          productSku: prod?.sku ?? '',
          posName: posInfo?.name ?? lv.point_of_sale_id.slice(0, 8),
        };
      })
      .filter((r) => {
        if (!q) return true;
        return (
          r.productName.toLowerCase().includes(q) ||
          r.productSku.toLowerCase().includes(q) ||
          r.posName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.productName.localeCompare(b.productName));
  }, [levels, productMap, posMap, search]);

  const stats = useMemo(() => {
    let neg = 0;
    let zero = 0;
    let pos = 0;
    for (const r of rows) {
      const q = Number(r.quantity_on_hand);
      if (q < 0) neg++;
      else if (q === 0) zero++;
      else pos++;
    }
    return { total: rows.length, neg, zero, pos };
  }, [rows]);

  if (!auth.ready) return <div className="text-sm text-gray-500">Chargement…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Niveaux de stock</h2>
        <p className="text-sm text-gray-500">
          État courant des stocks par produit et point de vente. Vue automatiquement
          mise à jour à chaque mouvement. Pour saisir, va sur les pages dédiées :{' '}
          <Link href="/operations/inventory/morning" className="text-brand-700 hover:underline">Stock matin</Link>
          {' · '}
          <Link href="/operations/inventory/transfers" className="text-brand-700 hover:underline">Transferts</Link>
          {' · '}
          <Link href="/operations/inventory/cuttings" className="text-brand-700 hover:underline">Découpes</Link>
          {' · '}
          <Link href="/operations/inventory/daily" className="text-brand-700 hover:underline">Stock soir</Link>.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-gray-200 bg-white p-3">
        <div>
          <label className="block text-xs font-medium text-gray-600">Point de vente</label>
          <select
            value={posId}
            onChange={(e) => setPosId(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm"
          >
            <option value="">Tous les PV</option>
            {pos.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-gray-600">Recherche</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Produit, SKU, PV…"
            className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div className="ml-auto flex gap-2 text-xs">
          <span className="rounded-md bg-green-50 border border-green-200 px-3 py-1.5 text-green-900">
            <b>{stats.pos}</b> en stock
          </span>
          <span className="rounded-md bg-gray-50 border border-gray-200 px-3 py-1.5 text-gray-700">
            <b>{stats.zero}</b> épuisés
          </span>
          {stats.neg > 0 && (
            <span className="rounded-md bg-red-50 border border-red-200 px-3 py-1.5 text-red-900">
              <b>{stats.neg}</b> négatifs ⚠
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>Produit</Th>
              <Th>Point de vente</Th>
              <Th className="text-right">Quantité</Th>
              <Th>Mis à jour</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">Aucun stock</td>
              </tr>
            )}
            {rows.map((r) => {
              const q = Number(r.quantity_on_hand);
              const rowCls =
                q < 0 ? 'bg-red-50/40' :
                q === 0 ? 'text-gray-400' :
                '';
              return (
                <tr key={r.id} className={rowCls}>
                  <Td>
                    <div className="font-medium">{r.productName}</div>
                    {r.productSku && <div className="text-[11px] text-gray-500">{r.productSku}</div>}
                  </Td>
                  <Td>{r.posName}</Td>
                  <Td className={`text-right tabular-nums font-mono ${q < 0 ? 'text-red-700 font-semibold' : ''}`}>
                    {q.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}
                  </Td>
                  <Td className="text-xs text-gray-500">
                    {new Date(r.updated_at).toLocaleString('fr-FR')}
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
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2 ${className}`}>{children}</td>;
}
