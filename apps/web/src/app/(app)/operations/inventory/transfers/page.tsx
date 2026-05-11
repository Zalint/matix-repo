'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import {
  api,
  type PointOfSale,
  type Product,
  type StockMovement,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/**
 * /operations/inventory/transfers — Transferts inter-PV (vue + saisie).
 *
 * Affiche les transferts du jour (entrants/sortants) et permet d'en créer un
 * nouveau. Chaque transfert est atomique : un transfer_out sur le PV source +
 * un transfer_in sur le PV cible, dans la même transaction.
 *
 * Les lignes affichées sont les mouvements `transfer_in` et `transfer_out`
 * filtrés sur la date. Si on filtre par PV, on voit ce qui sort (out) et ce
 * qui rentre (in) sur ce PV.
 */
export default function TransfersPage() {
  const auth = useAuth();
  const toast = useToast();

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [pos, setPos] = useState<PointOfSale[]>([]);
  const [posId, setPosId] = useState<string>('');
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

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

  async function reload() {
    if (!auth.ready) return;
    try {
      const mv = await api.inventory.movements(
        auth,
        posId ? { point_of_sale_id: posId, limit: 500 } : { limit: 500 },
      );
      setMovements(mv);
    } catch (e) {
      toast.error(String(e), { title: 'Mouvements' });
    }
  }

  useEffect(() => {
    if (!auth.ready) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready, posId]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const posMap = useMemo(() => new Map(pos.map((p) => [p.id, p])), [pos]);

  // Lignes : transfer_in et transfer_out du jour, triées par heure desc
  const rows = useMemo(() => {
    return movements
      .filter(
        (m) =>
          (m.movement_type === 'transfer_in' || m.movement_type === 'transfer_out') &&
          m.performed_at.slice(0, 10) === date,
      )
      .sort((a, b) => (a.performed_at > b.performed_at ? -1 : 1));
  }, [movements, date]);

  // Stats : nb mouvements et volumes nets
  const stats = useMemo(() => {
    let nbIn = 0;
    let nbOut = 0;
    let totalIn = 0;
    let totalOut = 0;
    for (const r of rows) {
      const q = Number(r.quantity);
      if (r.movement_type === 'transfer_in') {
        nbIn++;
        totalIn += q;
      } else {
        nbOut++;
        totalOut += Math.abs(q);
      }
    }
    return { nbIn, nbOut, totalIn, totalOut };
  }, [rows]);

  async function handleTransfer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!auth.ready) return;
    setBusy(true);
    const f = e.currentTarget;
    const fd = new FormData(f);
    try {
      await api.inventory.transfer(auth, {
        product_id: String(fd.get('product_id')),
        from_point_of_sale_id: String(fd.get('from_point_of_sale_id')),
        to_point_of_sale_id: String(fd.get('to_point_of_sale_id')),
        quantity: Number(fd.get('quantity')),
        reason: (fd.get('reason') as string) || undefined,
      });
      f.reset();
      setShowForm(false);
      toast.success('Transfert enregistré.');
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Transfert' });
    } finally {
      setBusy(false);
    }
  }

  if (!auth.ready) return <div className="text-sm text-gray-500">Chargement…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Transferts</h2>
          <p className="text-sm text-gray-500">
            Mouvements de stock entre points de vente. Chaque transfert est atomique :
            sortie au PV source + entrée au PV cible.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Annuler' : '+ Nouveau transfert'}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleTransfer} className="rounded-md border border-gray-200 bg-white p-4 space-y-3">
          <h3 className="text-sm font-semibold">Nouveau transfert</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <select
              name="product_id"
              required
              className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
            >
              <option value="">— Produit —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>
              ))}
            </select>
            <Input
              name="quantity"
              type="number"
              step="0.001"
              min="0.001"
              placeholder="Quantité (kg)"
              required
            />
            <select
              name="from_point_of_sale_id"
              required
              className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
            >
              <option value="">— PV source —</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              name="to_point_of_sale_id"
              required
              className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
            >
              <option value="">— PV cible —</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <Input name="reason" placeholder="Motif (optionnel)" className="sm:col-span-2" />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Transfert…' : 'Effectuer le transfert'}
          </Button>
        </form>
      )}

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
            <option value="">Tous les PV</option>
            {pos.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex gap-2">
          <div className="rounded-md bg-cyan-50 border border-cyan-200 px-3 py-1.5 text-xs text-cyan-900">
            <b>{stats.nbIn}</b> entrée(s) · <b>{stats.totalIn.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}</b> kg
          </div>
          <div className="rounded-md bg-pink-50 border border-pink-200 px-3 py-1.5 text-xs text-pink-900">
            <b>{stats.nbOut}</b> sortie(s) · <b>{stats.totalOut.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}</b> kg
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>Heure</Th>
              <Th>Sens</Th>
              <Th>Produit</Th>
              <Th>Point de vente</Th>
              <Th className="text-right">Quantité</Th>
              <Th>Motif</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  Aucun transfert sur cette date{posId ? ' / PV' : ''}.
                </td>
              </tr>
            )}
            {rows.map((m) => {
              const isIn = m.movement_type === 'transfer_in';
              const prod = productMap.get(m.product_id);
              const posInfo = posMap.get(m.point_of_sale_id);
              return (
                <tr key={m.id}>
                  <Td className="text-xs whitespace-nowrap">
                    {new Date(m.performed_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </Td>
                  <Td>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      isIn ? 'bg-cyan-100 text-cyan-800' : 'bg-pink-100 text-pink-800'
                    }`}>
                      {isIn ? 'Entrée' : 'Sortie'}
                    </span>
                  </Td>
                  <Td>
                    <div>{prod?.name ?? m.product_id.slice(0, 8)}</div>
                    {prod && <div className="text-[11px] text-gray-500">{prod.sku}</div>}
                  </Td>
                  <Td>{posInfo?.name ?? m.point_of_sale_id.slice(0, 8)}</Td>
                  <Td className={`text-right tabular-nums ${isIn ? 'text-cyan-700' : 'text-pink-700'}`}>
                    {Number(m.quantity) > 0 ? '+' : ''}
                    {Number(m.quantity).toLocaleString('fr-FR', { maximumFractionDigits: 3 })}
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
