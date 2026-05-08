'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  api,
  type MovementType,
  type PointOfSale,
  type Product,
  type StockLevel,
  type StockMovement,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type Tab = 'levels' | 'opening' | 'closing' | 'transfer' | 'journal';

const MOVEMENT_LABELS: Record<MovementType, string> = {
  opening: 'Ouverture',
  closing: 'Clôture',
  sale: 'Vente',
  return: 'Retour',
  adjustment: 'Ajustement',
  transfer_in: 'Transfert entrée',
  transfer_out: 'Transfert sortie',
};

const MOVEMENT_COLORS: Record<MovementType, string> = {
  opening: 'bg-blue-100 text-blue-800',
  closing: 'bg-purple-100 text-purple-800',
  sale: 'bg-green-100 text-green-800',
  return: 'bg-orange-100 text-orange-800',
  adjustment: 'bg-yellow-100 text-yellow-800',
  transfer_in: 'bg-cyan-100 text-cyan-800',
  transfer_out: 'bg-pink-100 text-pink-800',
};

export default function InventoryPage() {
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>('levels');
  const [products, setProducts] = useState<Product[]>([]);
  const [pos, setPos] = useState<PointOfSale[]>([]);
  const [levels, setLevels] = useState<StockLevel[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [filterPosId, setFilterPosId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Loaders
  const reload = async () => {
    if (!auth.ready) return;
    setError(null);
    try {
      const [p, ps, lv, mv] = await Promise.all([
        api.products.list(auth),
        api.pointsOfSale.list(auth, { activeOnly: true }),
        api.inventory.levels(auth, filterPosId ? { point_of_sale_id: filterPosId } : undefined),
        api.inventory.movements(auth, { limit: 50, ...(filterPosId ? { point_of_sale_id: filterPosId } : {}) }),
      ]);
      setProducts(p);
      setPos(ps);
      setLevels(lv);
      setMovements(mv);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    reload();
  }, [auth, filterPosId]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const posMap = useMemo(() => new Map(pos.map((p) => [p.id, p])), [pos]);

  // Forms
  async function handleMovement(e: FormEvent<HTMLFormElement>, type: 'opening' | 'closing' | 'adjustment') {
    e.preventDefault();
    if (!auth.ready) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const f = e.currentTarget;
    const fd = new FormData(f);
    try {
      await api.inventory.recordMovement(auth, {
        product_id: String(fd.get('product_id')),
        point_of_sale_id: String(fd.get('point_of_sale_id')),
        movement_type: type,
        quantity: Number(fd.get('quantity')),
        unit_cost: fd.get('unit_cost') ? Number(fd.get('unit_cost')) : undefined,
        reason: (fd.get('reason') as string) || undefined,
      });
      f.reset();
      setSuccess(`${MOVEMENT_LABELS[type]} enregistré.`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleTransfer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!auth.ready) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
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
      setSuccess('Transfert enregistré.');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!auth.ready) return <div className="text-sm text-gray-500">Chargement…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Stock</h2>
        <p className="text-sm text-gray-500">
          Stocks par point de vente, mouvements (ouverture / clôture / ajustement / retour) et transferts inter-PV.
        </p>
      </div>

      {/* Filtre PV */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600">Point de vente :</label>
        <select
          value={filterPosId}
          onChange={(e) => setFilterPosId(e.target.value)}
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">Tous les PV</option>
          {pos.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {([
          ['levels', 'Stocks actuels'],
          ['opening', 'Ouverture'],
          ['closing', 'Clôture'],
          ['transfer', 'Transfert'],
          ['journal', 'Journal'],
        ] as Array<[Tab, string]>).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t
                ? 'border-b-2 border-brand-600 text-brand-700'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>}

      {/* Tab content */}
      {tab === 'levels' && (
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
              {levels.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Aucun stock</td></tr>
              )}
              {levels.map((lv) => {
                const prod = productMap.get(lv.product_id);
                const ps = posMap.get(lv.point_of_sale_id);
                return (
                  <tr key={lv.id}>
                    <Td>{prod ? `${prod.sku} — ${prod.name}` : lv.product_id.slice(0, 8)}</Td>
                    <Td>{ps?.name ?? lv.point_of_sale_id.slice(0, 8)}</Td>
                    <Td className="text-right font-mono">{Number(lv.quantity_on_hand).toLocaleString('fr-FR')}</Td>
                    <Td className="text-xs text-gray-500">{new Date(lv.updated_at).toLocaleString('fr-FR')}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(tab === 'opening' || tab === 'closing') && (
        <form
          onSubmit={(e) => handleMovement(e, tab as 'opening' | 'closing')}
          className="rounded-md border bg-white p-5 space-y-3"
        >
          <h3 className="text-sm font-semibold">
            {tab === 'opening' ? 'Saisie stock matin (ouverture)' : 'Saisie stock soir (clôture)'}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ProductSelect name="product_id" products={products} required />
            <PosSelect name="point_of_sale_id" pos={pos} required defaultId={filterPosId} />
            <Input
              name="quantity"
              type="number"
              step="0.001"
              min="0"
              placeholder={tab === 'opening' ? 'Quantité ouverture' : 'Quantité clôture (peut être 0)'}
              required
            />
            <Input name="unit_cost" type="number" step="0.01" min="0" placeholder="Coût unitaire (optionnel)" />
            <Input name="reason" placeholder="Note (optionnel)" className="sm:col-span-2" />
          </div>
          <Button type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button>
        </form>
      )}

      {tab === 'transfer' && (
        <form onSubmit={handleTransfer} className="rounded-md border bg-white p-5 space-y-3">
          <h3 className="text-sm font-semibold">Transfert inter-PV</h3>
          <p className="text-xs text-gray-500">
            Sortie au PV source + entrée au PV cible, atomique. Le stock du PV source doit être suffisant.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ProductSelect name="product_id" products={products} required />
            <Input name="quantity" type="number" step="0.001" min="0.001" placeholder="Quantité" required />
            <PosSelect name="from_point_of_sale_id" pos={pos} required label="PV source" />
            <PosSelect name="to_point_of_sale_id" pos={pos} required label="PV cible" />
            <Input name="reason" placeholder="Motif du transfert (optionnel)" className="sm:col-span-2" />
          </div>
          <Button type="submit" disabled={busy}>{busy ? 'Transfert…' : 'Effectuer le transfert'}</Button>
        </form>
      )}

      {tab === 'journal' && (
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <Th>Date/Heure</Th>
                <Th>Type</Th>
                <Th>Produit</Th>
                <Th>Point de vente</Th>
                <Th className="text-right">Qté</Th>
                <Th>Motif</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {movements.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucun mouvement</td></tr>
              )}
              {movements.map((m) => {
                const prod = productMap.get(m.product_id);
                const ps = posMap.get(m.point_of_sale_id);
                return (
                  <tr key={m.id}>
                    <Td className="text-xs text-gray-500">{new Date(m.performed_at).toLocaleString('fr-FR')}</Td>
                    <Td>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${MOVEMENT_COLORS[m.movement_type]}`}>
                        {MOVEMENT_LABELS[m.movement_type]}
                      </span>
                    </Td>
                    <Td className="text-xs">{prod ? `${prod.sku}` : m.product_id.slice(0, 8)}</Td>
                    <Td className="text-xs">{ps?.name ?? m.point_of_sale_id.slice(0, 8)}</Td>
                    <Td className={`text-right font-mono ${Number(m.quantity) < 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {Number(m.quantity) > 0 ? '+' : ''}{Number(m.quantity).toLocaleString('fr-FR')}
                    </Td>
                    <Td className="text-xs text-gray-600">{m.reason ?? '—'}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProductSelect({ name, products, required }: { name: string; products: Product[]; required?: boolean }) {
  return (
    <select
      name={name}
      required={required}
      className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
    >
      <option value="">— Choisir un produit —</option>
      {products.map((p) => (
        <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>
      ))}
    </select>
  );
}

function PosSelect({
  name,
  pos,
  required,
  label,
  defaultId,
}: {
  name: string;
  pos: PointOfSale[];
  required?: boolean;
  label?: string;
  defaultId?: string;
}) {
  return (
    <select
      name={name}
      required={required}
      defaultValue={defaultId ?? ''}
      className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
    >
      <option value="">— {label ?? 'Choisir un PV'} —</option>
      {pos.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2 text-left font-medium text-gray-600 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2 ${className}`}>{children}</td>;
}
