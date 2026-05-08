'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, type Product, type ProductCategory } from '@/lib/api';
import type { AuthState } from '@/lib/auth-context';

/**
 * Hook catalogue produits — charge produits + catégories, expose un filtre par catégorie + recherche texte.
 * UI agnostique : retourne juste les listes filtrées et les setters.
 */
export function useProductCatalog(auth: AuthState) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Filtres : navigation à 2 niveaux (family puis category)
  const [activeFamily, setActiveFamily] = useState<string | null>(null);
  const [activeCategoryId, setActiveCategoryIdRaw] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!auth.ready) return;
    setLoading(true);
    Promise.all([api.products.list(auth), api.productCategories.list(auth, { activeOnly: true })])
      .then(([p, c]) => {
        setProducts(p);
        setCategories(c);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [auth]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  /**
   * Catégories utilisables comme onglets — on n'affiche que celles qui ont au moins
   * 1 produit assigné (parité avec le comportement Maas : "Bovin" n'apparaît que si
   * le tenant a vendu du bœuf au moins une fois).
   */
  const usedCategories = useMemo(() => {
    const usedIds = new Set(products.map((p) => p.category_id).filter(Boolean) as string[]);
    return categories.filter((c) => usedIds.has(c.id));
  }, [products, categories]);

  /** Familles présentes (boucherie / epicerie / null), dans l'ordre boucherie → epicerie. */
  const families = useMemo(() => {
    const set = new Set(usedCategories.map((c) => c.family).filter(Boolean) as string[]);
    const all = Array.from(set);
    // Ordre stable : boucherie d'abord, epicerie ensuite, le reste alphabétique
    return all.sort((a, b) => {
      if (a === 'boucherie') return -1;
      if (b === 'boucherie') return 1;
      if (a === 'epicerie') return -1;
      if (b === 'epicerie') return 1;
      return a.localeCompare(b);
    });
  }, [usedCategories]);

  /** Sous-catégories de la family active (vide si aucune family sélectionnée). */
  const subCategories = useMemo(() => {
    if (!activeFamily) return [];
    return usedCategories.filter((c) => c.family === activeFamily);
  }, [usedCategories, activeFamily]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((p) => {
      // Filtre catégorie précise (gagne sur family)
      if (activeCategoryId) {
        if (p.category_id !== activeCategoryId) return false;
      } else if (activeFamily) {
        const cat = p.category_id ? categoryById.get(p.category_id) : undefined;
        if (cat?.family !== activeFamily) return false;
      }
      if (!needle) return true;
      return p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle);
    });
  }, [products, categoryById, activeCategoryId, activeFamily, search]);

  // Setters qui maintiennent la cohérence (changer category sans family ⇒ déduire family)
  const setActiveCategoryId = (id: string | null) => {
    setActiveCategoryIdRaw(id);
    if (id) {
      const cat = categoryById.get(id);
      if (cat?.family) setActiveFamily(cat.family);
    }
  };
  const selectFamily = (family: string | null) => {
    setActiveFamily(family);
    setActiveCategoryIdRaw(null);
  };
  const selectAll = () => {
    setActiveFamily(null);
    setActiveCategoryIdRaw(null);
  };

  return {
    products,
    filtered,
    categories,
    usedCategories,
    categoryById,
    families,
    subCategories,
    activeFamily,
    activeCategoryId,
    setActiveCategoryId,
    selectFamily,
    selectAll,
    search,
    setSearch,
    loading,
    error,
  };
}
