'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Customer, PointOfSale, Product, ProductCategory } from '@/lib/api';

type Line = {
  category_id: string;
  product_id: string;
  unit_price: number;
  quantity: number;
};

const emptyLine: Line = { category_id: '', product_id: '', unit_price: 0, quantity: 0 };

type Props = {
  date: string;
  onDateChange: (d: string) => void;
  pointsOfSale: PointOfSale[];
  selectedPosId: string;
  onSelectedPosChange: (id: string) => void;
  customers: Customer[];
  products: Product[];
  categories: ProductCategory[];
  busy?: boolean;
  onSubmit: (input: {
    date: string;
    point_of_sale_id: string;
    customer_id: string | null;
    customer_walkin?: { name: string; phone: string; address: string };
    is_credit: boolean;
    lines: Array<{ product_id: string; quantity: number; unit_price: number }>;
  }) => Promise<void> | void;
};

function formatXof(n: number) {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' FCFA';
}

/**
 * Formulaire "Standard" — saisie back-entry façon Maas App index.html.
 * Permet de saisir une vente avec date éditable, lignes multiples, et flag créance.
 *
 * Indépendant de l'API : passe les données validées via onSubmit.
 */
export function StandardSalesForm({
  date,
  onDateChange,
  pointsOfSale,
  selectedPosId,
  onSelectedPosChange,
  customers,
  products,
  categories,
  busy,
  onSubmit,
}: Props) {
  // Client info
  const [customerId, setCustomerId] = useState<string>('');
  const [walkinName, setWalkinName] = useState('');
  const [walkinPhone, setWalkinPhone] = useState('');
  const [walkinAddress, setWalkinAddress] = useState('');
  const [isCredit, setIsCredit] = useState(false);

  // Lines
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);

  const [error, setError] = useState<string | null>(null);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const productsByCategory = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of products) {
      const key = p.category_id ?? '__none__';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p);
    }
    return m;
  }, [products]);

  // Pre-fill walk-in fields from customer selection
  useEffect(() => {
    if (!customerId) return;
    const c = customers.find((x) => x.id === customerId);
    if (!c) return;
    setWalkinName(c.display_name);
    setWalkinPhone(c.phone ?? '');
    setWalkinAddress(c.address ?? '');
  }, [customerId, customers]);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, ...patch };
        // If product changed, auto-fill unit_price from catalog
        if (patch.product_id && patch.product_id !== l.product_id) {
          const p = productMap.get(patch.product_id);
          if (p) next.unit_price = Number(p.unit_price);
        }
        // If category changed, reset product
        if (patch.category_id !== undefined && patch.category_id !== l.category_id) {
          next.product_id = '';
          next.unit_price = 0;
        }
        return next;
      }),
    );
  }
  function addLine() {
    setLines((prev) => [...prev, { ...emptyLine }]);
  }
  function removeLine(i: number) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  const total = lines.reduce(
    (s, l) => s + (l.quantity > 0 ? l.quantity * l.unit_price : 0),
    0,
  );

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!selectedPosId) return setError('Choisis un point de vente');
    const validLines = lines.filter(
      (l) => l.product_id && l.quantity > 0 && l.unit_price >= 0,
    );
    if (validLines.length === 0) {
      return setError('Ajoute au moins une ligne complète (catégorie, produit, quantité)');
    }

    try {
      await onSubmit({
        date,
        point_of_sale_id: selectedPosId,
        customer_id: customerId || null,
        customer_walkin:
          !customerId && (walkinName || walkinPhone || walkinAddress)
            ? { name: walkinName, phone: walkinPhone, address: walkinAddress }
            : undefined,
        is_credit: isCredit,
        lines: validLines.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
        })),
      });
      // Reset form on success
      setLines([{ ...emptyLine }]);
      setCustomerId('');
      setWalkinName('');
      setWalkinPhone('');
      setWalkinAddress('');
      setIsCredit(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border border-gray-200 bg-white p-5">
      {/* Date + PV row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date" required>
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
            required
          />
        </Field>
        <Field label="Point de Vente" required>
          <select
            value={selectedPosId}
            onChange={(e) => onSelectedPosChange(e.target.value)}
            className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
            required
          >
            <option value="">Sélectionner un point de vente</option>
            {pointsOfSale.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Customer */}
      <div className="space-y-3">
        <Field label="📚 Client Abonné">
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
          >
            <option value="">— Aucun —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.display_name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Sélectionnez un client abonné pour bénéficier des prix préférentiels (à venir).
          </p>
        </Field>

        <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700">
          ℹ Les informations client sont optionnelles. Si renseignées, elles seront appliquées à
          tous les produits de cette commande.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Nom Client">
            <Input
              type="text"
              value={walkinName}
              onChange={(e) => setWalkinName(e.target.value)}
              placeholder="Nom du client"
              disabled={!!customerId}
            />
          </Field>
          <Field label="Numéro Client">
            <Input
              type="tel"
              value={walkinPhone}
              onChange={(e) => setWalkinPhone(e.target.value)}
              placeholder="Ex: 773900000"
              disabled={!!customerId}
            />
          </Field>
          <Field label="Adresse Client">
            <Input
              type="text"
              value={walkinAddress}
              onChange={(e) => setWalkinAddress(e.target.value)}
              placeholder="Adresse du client"
              disabled={!!customerId}
            />
          </Field>
          <Field label="Créance">
            <select
              value={isCredit ? 'oui' : 'non'}
              onChange={(e) => setIsCredit(e.target.value === 'oui')}
              className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
            >
              <option value="non">Non</option>
              <option value="oui">Oui (crédit client)</option>
            </select>
          </Field>
        </div>
      </div>

      {/* Lines */}
      <div className="space-y-2">
        {lines.map((l, i) => {
          const productsForCat = l.category_id
            ? productsByCategory.get(l.category_id) ?? []
            : products;
          const lineTotal = l.quantity * l.unit_price;
          return (
            <div
              key={i}
              className="grid grid-cols-1 items-end gap-2 rounded-md border border-gray-100 bg-gray-50 p-3 sm:grid-cols-[1.2fr_1.5fr_1fr_0.8fr_1fr_auto]"
            >
              <Field label={i === 0 ? 'Catégorie *' : ''}>
                <select
                  value={l.category_id}
                  onChange={(e) => updateLine(i, { category_id: e.target.value })}
                  className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
                >
                  <option value="">Sélectionner une catégorie</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={i === 0 ? 'Produit *' : ''}>
                <select
                  value={l.product_id}
                  onChange={(e) => updateLine(i, { product_id: e.target.value })}
                  className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
                  disabled={!l.category_id && categories.length > 0}
                >
                  <option value="">Sélectionner un produit</option>
                  {productsForCat.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={i === 0 ? 'Prix Unit. *' : ''}>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={l.unit_price}
                  onChange={(e) => updateLine(i, { unit_price: Number(e.target.value) })}
                />
              </Field>
              <Field label={i === 0 ? 'Quantité *' : ''}>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={l.quantity}
                  onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                />
              </Field>
              <Field label={i === 0 ? 'Total' : ''}>
                <Input
                  type="text"
                  value={formatXof(lineTotal)}
                  readOnly
                  className="bg-gray-100 font-medium"
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeLine(i)}
                disabled={lines.length === 1}
                aria-label="Retirer ligne"
              >
                ×
              </Button>
            </div>
          );
        })}

        <Button type="button" variant="secondary" size="sm" onClick={addLine}>
          + Ajouter un produit
        </Button>
      </div>

      <p className="text-xs text-gray-500">* Champs obligatoires</p>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Total + Submit */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Total Général
          </div>
          <div className="mt-1 text-2xl font-bold text-blue-600">{formatXof(total)}</div>
        </div>
        <Button
          type="submit"
          disabled={busy || total <= 0 || !selectedPosId}
          className="h-full !bg-indigo-500 hover:!bg-indigo-600 disabled:!bg-indigo-300"
        >
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      {label && (
        <label className="mb-1 block text-xs font-medium text-gray-600">
          {label}
          {required && <span className="text-red-500"> *</span>}
        </label>
      )}
      {children}
    </div>
  );
}
