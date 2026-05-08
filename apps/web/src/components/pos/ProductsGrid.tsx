'use client';

import type { Product, ProductCategory } from '@/lib/api';

type Props = {
  products: Product[];
  filtered: Product[];
  categories: ProductCategory[];
  categoryById: Map<string, ProductCategory>;
  /** Familles présentes (ex: ['boucherie','epicerie']). */
  families: string[];
  /** Sous-catégories de la family active. */
  subCategories: ProductCategory[];
  activeFamily: string | null;
  activeCategoryId: string | null;
  onSelectAll: () => void;
  onSelectFamily: (family: string | null) => void;
  onSelectCategory: (id: string | null) => void;
  search: string;
  onSearchChange: (s: string) => void;
  onPickProduct: (p: Product) => void;
  loading?: boolean;
};

function formatXof(n: number | string) {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' FCFA';
}

const FAMILY_LABELS: Record<string, string> = {
  boucherie: 'Boucherie',
  epicerie: 'Épicerie',
};
function familyLabel(f: string): string {
  return FAMILY_LABELS[f] ?? f.charAt(0).toUpperCase() + f.slice(1);
}

export function ProductsGrid({
  filtered,
  categoryById,
  families,
  subCategories,
  activeFamily,
  activeCategoryId,
  onSelectAll,
  onSelectFamily,
  onSelectCategory,
  search,
  onSearchChange,
  onPickProduct,
  loading,
}: Props) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <span aria-hidden>📦</span> Produits
        </h3>
        <button
          type="button"
          className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white opacity-50 cursor-not-allowed"
          disabled
          title="Découpe — module Procurement (à venir)"
        >
          Découpe
        </button>
      </div>

      {/* Search */}
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden>🔍</span>
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Rechercher un produit…"
            className="h-10 w-full rounded-md border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
      </div>

      {/* Family tabs (niveau 1) */}
      <div className="flex flex-wrap gap-2 border-b border-gray-100 px-4 py-3">
        <CategoryChip
          active={activeFamily === null && activeCategoryId === null}
          onClick={onSelectAll}
        >
          Tous
        </CategoryChip>
        {families.map((f) => (
          <CategoryChip
            key={f}
            active={activeFamily === f}
            onClick={() => onSelectFamily(f)}
          >
            {familyLabel(f)}
          </CategoryChip>
        ))}
      </div>

      {/* Subcategory tabs (niveau 2) — visible quand une family est active */}
      {activeFamily && subCategories.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2">
          <CategoryChip
            size="sm"
            active={activeCategoryId === null}
            onClick={() => onSelectCategory(null)}
          >
            Tous {familyLabel(activeFamily).toLowerCase()}
          </CategoryChip>
          {subCategories.map((c) => (
            <CategoryChip
              key={c.id}
              size="sm"
              active={activeCategoryId === c.id}
              onClick={() => onSelectCategory(c.id)}
            >
              {c.name}
            </CategoryChip>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-auto p-4">
        {loading && <p className="text-sm text-gray-500">Chargement…</p>}
        {!loading && filtered.length === 0 && (
          <div className="grid h-full place-items-center text-sm text-gray-400">
            {search ? `Aucun produit pour « ${search} »` : 'Aucun produit dans cette catégorie'}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((p) => {
            const cat = p.category_id ? categoryById.get(p.category_id) : undefined;
            return (
              <ProductCard
                key={p.id}
                product={p}
                categoryName={cat?.name}
                onClick={() => onPickProduct(p)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  children,
  size = 'md',
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  size?: 'md' | 'sm';
}) {
  const sizeClasses = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md font-medium transition ${sizeClasses} ${
        active
          ? 'bg-brand-600 text-white'
          : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

function ProductCard({
  product,
  categoryName,
  onClick,
}: {
  product: Product;
  categoryName?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-full flex-col items-center justify-between rounded-lg border border-gray-200 bg-white p-3 text-center shadow-sm transition hover:border-brand-300 hover:shadow"
    >
      <div className="line-clamp-2 text-sm font-medium text-gray-900">{product.name}</div>
      <div className="my-2 text-base font-bold text-brand-700">{formatXof(product.unit_price)}</div>
      {categoryName ? (
        <div className="text-xs text-gray-400">{categoryName}</div>
      ) : (
        <div className="text-xs text-gray-300">—</div>
      )}
    </button>
  );
}
