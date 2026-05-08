'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, type Product } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function ProductsPage() {
  const auth = useAuth();
  const [items, setItems] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    if (!auth.ready) return;
    setError(null);
    api.products.list(auth).then(setItems).catch((e) => setError(e.message));
  };

  useEffect(reload, [auth]);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!auth.ready) return;
    setBusy(true);
    setError(null);
    const f = e.currentTarget;
    const fd = new FormData(f);
    try {
      await api.products.create(auth, {
        sku: String(fd.get('sku')),
        name: String(fd.get('name')),
        unit_price: Number(fd.get('unit_price')),
      });
      f.reset();
      setShowForm(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!auth.ready) return;
    if (!confirm('Supprimer ce produit ?')) return;
    try {
      await api.products.remove(auth, id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!auth.ready) return <div className="text-sm text-gray-500">Chargement…</div>;

  const tenantLabel = auth.mode === 'dev' ? auth.tenantLabel : auth.userEmail ?? 'tenant';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Produits — {tenantLabel}</h2>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Annuler' : 'Nouveau produit'}</Button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {showForm && (
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 rounded-md border bg-white p-4 sm:grid-cols-4">
          <Input name="sku" placeholder="SKU (ex: COCA-33)" required />
          <Input name="name" placeholder="Nom" required className="sm:col-span-2" />
          <Input name="unit_price" type="number" min="0" step="1" placeholder="Prix XOF" required />
          <div className="sm:col-span-4">
            <Button type="submit" disabled={busy}>
              {busy ? 'Enregistrement…' : 'Créer'}
            </Button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>SKU</Th>
              <Th>Nom</Th>
              <Th className="text-right">Prix unitaire</Th>
              <Th className="w-20"></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  Aucun produit
                </td>
              </tr>
            )}
            {items.map((p) => (
              <tr key={p.id}>
                <Td className="font-mono">{p.sku}</Td>
                <Td>{p.name}</Td>
                <Td className="text-right">{Number(p.unit_price).toLocaleString('fr-FR')} XOF</Td>
                <Td>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(p.id)}>
                    Suppr.
                  </Button>
                </Td>
              </tr>
            ))}
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
