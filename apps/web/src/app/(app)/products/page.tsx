'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, type Product, type ProductCategory, type TenantSettings } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { PageSpinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';

export default function ProductsPage() {
  const auth = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  // Drafts pour l'inline edit du prix gros override, indexés par product_id
  const [grosDrafts, setGrosDrafts] = useState<Record<string, string>>({});

  const reload = () => {
    if (!auth.ready) return;
    Promise.all([
      api.products.list(auth),
      api.tenantSettings.get(auth),
      api.productCategories.list(auth, { activeOnly: true }),
    ])
      .then(([rows, s, cats]) => {
        setItems(rows);
        setSettings(s);
        setCategories(cats);
        const drafts: Record<string, string> = {};
        for (const p of rows) drafts[p.id] = p.unit_price_gros ?? '';
        setGrosDrafts(drafts);
      })
      .catch((e) => toast.error(e.message ?? String(e), { title: 'Chargement' }));
  };

  useEffect(reload, [auth]);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!auth.ready) return;
    setBusy(true);
    const f = e.currentTarget;
    const fd = new FormData(f);
    const grosRaw = String(fd.get('unit_price_gros') ?? '').trim();
    const grosEnabled = fd.get('gros_enabled') === 'on';
    const categoryId = String(fd.get('category_id') ?? '').trim();
    try {
      await api.products.create(auth, {
        sku: String(fd.get('sku')),
        name: String(fd.get('name')),
        unit_price: Number(fd.get('unit_price')),
        gros_enabled: grosEnabled,
        ...(grosRaw !== '' ? { unit_price_gros: Number(grosRaw) } : {}),
        ...(categoryId !== '' ? { category_id: categoryId } : {}),
      });
      f.reset();
      setShowForm(false);
      toast.success('Produit cree.');
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Creation' });
    } finally {
      setBusy(false);
    }
  }

  async function handleChangeCategory(p: Product, newCategoryId: string) {
    if (!auth.ready) return;
    // Empty string = retirer la catégorie (null)
    const next: string | null = newCategoryId === '' ? null : newCategoryId;
    if (next === p.category_id) return;
    try {
      await api.products.update(auth, p.id, { category_id: next });
      toast.success(
        next === null
          ? `${p.name} : catégorie retirée`
          : `${p.name} → ${categories.find((c) => c.id === next)?.name ?? 'catégorie'}`,
        { durationMs: 2000 },
      );
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Catégorie' });
    }
  }

  async function handleToggleGrosEnabled(p: Product) {
    if (!auth.ready) return;
    try {
      await api.products.update(auth, p.id, { gros_enabled: !p.gros_enabled });
      toast.success(
        p.gros_enabled
          ? `Vente en gros désactivée pour ${p.name}`
          : `Vente en gros activée pour ${p.name}`,
        { durationMs: 2000 },
      );
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Vente en gros' });
    }
  }

  async function handleSaveGrosOverride(p: Product) {
    if (!auth.ready) return;
    const raw = (grosDrafts[p.id] ?? '').trim();
    const next = raw === '' ? null : Number(raw);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      toast.warning('Prix gros invalide.', { title: p.name });
      return;
    }
    const current = p.unit_price_gros === null ? '' : p.unit_price_gros;
    if (raw === String(current)) return;
    try {
      await api.products.update(auth, p.id, { unit_price_gros: next });
      toast.success(
        next === null
          ? `Override retiré : ${p.name} utilise le rabais par défaut`
          : `Override prix gros : ${p.name} → ${next.toLocaleString('fr-FR')} XOF`,
        { durationMs: 2500 },
      );
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Override' });
    }
  }

  async function handleDelete(id: string) {
    if (!auth.ready) return;
    const ok = await toast.confirm({
      title: 'Supprimer ce produit ?',
      message: 'Cette action est definitive.',
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.products.remove(auth, id);
      toast.success('Produit supprime.');
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Suppression' });
    }
  }

  if (!auth.ready) return <PageSpinner />;

  const tenantLabel = auth.mode === 'dev' ? auth.tenantLabel : auth.userEmail ?? 'tenant';
  const rebate = settings?.default_gros_rebate_xof ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Produits — {tenantLabel}</h2>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Annuler' : 'Nouveau produit'}
        </Button>
      </div>

      {/* Rappel rabais courant */}
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
        <b>Rabais "vente en gros" par défaut :</b>{' '}
        {rebate > 0
          ? `${rebate.toLocaleString('fr-FR')} XOF (prix gros = prix détails − ${rebate.toLocaleString('fr-FR')})`
          : '0 XOF (prix gros = prix détails sauf override par produit)'}
        {' · '}
        <Link href="/settings/pricing" className="underline hover:no-underline">
          modifier
        </Link>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="space-y-3 rounded-md border bg-white p-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Input name="sku" placeholder="SKU (ex: COCA-33)" required />
            <Input name="name" placeholder="Nom" required className="sm:col-span-2" />
            <Input
              name="unit_price"
              type="number"
              min="0"
              step="1"
              placeholder="Prix détails (XOF)"
              required
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <select
              name="category_id"
              defaultValue=""
              className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
            >
              <option value="">— Sans catégorie —</option>
              {categoriesByFamily(categories).map(({ family, items: cats }) => (
                <optgroup key={family} label={family}>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="gros_enabled" className="h-4 w-4" />
              <span>Vente en gros activée</span>
            </label>
            <Input
              name="unit_price_gros"
              type="number"
              min="0"
              step="1"
              placeholder="Prix gros override (facultatif)"
              title="Laissez vide pour utiliser le rabais par défaut"
            />
            <Button type="submit" disabled={busy}>
              {busy ? 'Enregistrement…' : 'Créer'}
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            Pas de catégorie qui convient ?{' '}
            <Link href="/settings/categories" className="text-brand-700 hover:underline">
              Crée-la d'abord ici
            </Link>{' '}
            puis reviens créer ton produit.
          </p>
        </form>
      )}

      <p className="text-xs text-gray-500">
        Astuce : <b>activer la vente en gros</b> sur un produit fait apparaître le toggle
        <i> détails / gros</i> à la caisse. Le prix gros est calculé automatiquement à partir
        du rabais global. Pour un prix gros spécifique, saisissez-le dans la colonne
        <b> Prix gros (override)</b>.
      </p>

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>SKU</Th>
              <Th>Nom</Th>
              <Th>Catégorie</Th>
              <Th className="text-right">Prix détails</Th>
              <Th className="text-center">Vente gros</Th>
              <Th className="text-right">Prix gros effectif</Th>
              <Th className="text-right">Override</Th>
              <Th className="w-20">{' '}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  Aucun produit
                </td>
              </tr>
            )}
            {items.map((p) => {
              const effective = p.effective_gros_price !== null
                ? Number(p.effective_gros_price)
                : null;
              const hasOverride = p.unit_price_gros !== null;
              const currentCat = categories.find((c) => c.id === p.category_id);
              return (
                <tr key={p.id}>
                  <Td className="font-mono">{p.sku}</Td>
                  <Td>{p.name}</Td>
                  <Td>
                    <select
                      value={p.category_id ?? ''}
                      onChange={(e) => handleChangeCategory(p, e.target.value)}
                      className="h-8 w-full max-w-[200px] rounded border border-transparent bg-transparent px-1 text-xs hover:border-gray-300 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      <option value="">— Sans catégorie —</option>
                      {categoriesByFamily(categories).map(({ family, items: cats }) => (
                        <optgroup key={family} label={family}>
                          {cats.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {currentCat?.family && (
                      <div className="text-[10px] text-gray-400 px-1">{currentCat.family}</div>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {Number(p.unit_price).toLocaleString('fr-FR')} XOF
                  </Td>
                  <Td className="text-center">
                    <button
                      type="button"
                      onClick={() => handleToggleGrosEnabled(p)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                        p.gros_enabled ? 'bg-brand-600' : 'bg-gray-300'
                      }`}
                      aria-label={p.gros_enabled ? 'Désactiver vente gros' : 'Activer vente gros'}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                          p.gros_enabled ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {effective === null ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <>
                        <span className={hasOverride ? 'font-medium' : ''}>
                          {effective.toLocaleString('fr-FR')} XOF
                        </span>
                        <div className="text-[10px] text-gray-500">
                          {hasOverride ? 'override' : `auto (−${rebate.toLocaleString('fr-FR')})`}
                        </div>
                      </>
                    )}
                  </Td>
                  <Td className="text-right">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={grosDrafts[p.id] ?? ''}
                      onChange={(e) =>
                        setGrosDrafts((d) => ({ ...d, [p.id]: e.target.value }))
                      }
                      onBlur={() => handleSaveGrosOverride(p)}
                      placeholder={
                        p.gros_enabled
                          ? `auto: ${Math.max(Number(p.unit_price) - rebate, 0)}`
                          : '—'
                      }
                      disabled={!p.gros_enabled}
                      className="h-8 w-28 rounded border border-gray-300 px-2 text-right text-xs tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400"
                    />
                  </Td>
                  <Td>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(p.id)}>
                      Suppr.
                    </Button>
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

/**
 * Groupe les catégories par famille pour les <optgroup> du select.
 * Les "sans famille" se retrouvent dans un groupe dédié à la fin.
 */
function categoriesByFamily(
  cats: ProductCategory[],
): Array<{ family: string; items: ProductCategory[] }> {
  const map = new Map<string, ProductCategory[]>();
  for (const c of cats) {
    const f = c.family ?? '— Sans famille —';
    const list = map.get(f) ?? [];
    list.push(c);
    map.set(f, list);
  }
  return Array.from(map.entries())
    .map(([family, list]) => ({
      family,
      items: list.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.family.localeCompare(b.family));
}
