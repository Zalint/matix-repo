'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { PageSpinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import {
  api,
  type PointOfSale,
  type Product,
  type StockMovement,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/**
 * /operations/inventory/morning — Stock matin (read-only).
 *
 * Affiche les mouvements `opening` de la date sélectionnée, par produit/PV.
 * Ces mouvements sont créés automatiquement par le cron carry-over à 00:30
 * (stock soir J-1 → stock matin J). On consulte ici pour vérifier que le
 * carry-over s'est bien passé.
 *
 * Pas de saisie : si le stock matin manque pour un produit (cas oubli ou
 * nouveau produit créé en cours de journée), c'est sur la page Stock soir
 * que ça se règle, ou via un ajustement.
 */
export default function MorningStockPage() {
  const auth = useAuth();
  const toast = useToast();

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [pos, setPos] = useState<PointOfSale[]>([]);
  const [posId, setPosId] = useState<string>('');
  const [products, setProducts] = useState<Product[]>([]);
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
        if (ps.length > 0 && !posId) setPosId(ps[0].id);
      })
      .catch((e) => toast.error(String(e), { title: 'Chargement' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready]);

  useEffect(() => {
    if (!auth.ready || !posId) return;
    api.inventory
      .movements(auth, { point_of_sale_id: posId, limit: 500 })
      .then(setMovements)
      .catch((e) => toast.error(String(e), { title: 'Mouvements' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready, posId]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // On filtre les `opening` du jour. Si plusieurs mouvements opening pour le
  // même produit (rare, mais possible si ajustement manuel + carry-over), on
  // affiche la somme.
  const morningRows = useMemo(() => {
    const grouped = new Map<string, { quantity: number; lastAt: string; reasons: Set<string> }>();
    for (const m of movements) {
      if (m.movement_type !== 'opening') continue;
      const mvDate = m.performed_at.slice(0, 10);
      if (mvDate !== date) continue;
      const key = m.product_id;
      const cur = grouped.get(key) ?? { quantity: 0, lastAt: m.performed_at, reasons: new Set<string>() };
      cur.quantity += Number(m.quantity);
      if (m.performed_at > cur.lastAt) cur.lastAt = m.performed_at;
      if (m.reason) cur.reasons.add(m.reason);
      grouped.set(key, cur);
    }
    return Array.from(grouped.entries())
      .map(([product_id, info]) => ({ product_id, ...info, reasons: Array.from(info.reasons) }))
      .sort((a, b) => {
        const na = productMap.get(a.product_id)?.name ?? a.product_id;
        const nb = productMap.get(b.product_id)?.name ?? b.product_id;
        return na.localeCompare(nb);
      });
  }, [movements, date, productMap]);

  const totalQty = morningRows.reduce((s, r) => s + r.quantity, 0);

  if (!auth.ready) return <PageSpinner />;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Stock matin</h2>
        <p className="text-sm text-gray-500">
          Stock présent à l'ouverture du PV, généré automatiquement par le report de nuit
          (stock soir J-1 → stock matin J). Page en lecture seule. Pour ajuster, passe par{' '}
          <Link href="/operations/inventory/daily" className="text-brand-700 hover:underline">
            Stock soir
          </Link>
          {' '}ou un ajustement.
        </p>
      </div>

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
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto rounded-md bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs text-blue-900">
          <b>{morningRows.length}</b> produit(s) · total <b>{totalQty.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}</b> kg
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>Produit</Th>
              <Th className="text-right">Quantité</Th>
              <Th>Heure</Th>
              <Th>Origine</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {morningRows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  Aucun stock matin enregistré sur cette date / PV.
                  <div className="text-[11px] mt-1">
                    Le carry-over a lieu à 00:30 (Africa/Dakar). Si tu consultes avant cette heure, c'est normal.
                  </div>
                </td>
              </tr>
            )}
            {morningRows.map((r) => {
              const prod = productMap.get(r.product_id);
              return (
                <tr key={r.product_id}>
                  <Td>
                    <div className="font-medium">{prod?.name ?? r.product_id.slice(0, 8)}</div>
                    {prod && <div className="text-[11px] text-gray-500">{prod.sku}</div>}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {r.quantity.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} kg
                  </Td>
                  <Td className="text-xs text-gray-500 whitespace-nowrap">
                    {new Date(r.lastAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </Td>
                  <Td className="text-xs text-gray-500">
                    {r.reasons.length > 0 ? r.reasons.join(', ') : '—'}
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
