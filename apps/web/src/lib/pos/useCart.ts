'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Product } from '@/lib/api';

export type CartLine = {
  product_id: string;
  sku: string;
  name: string;
  unit_price: number;            // prix appliqué (= unit_price_detail si variant='detail', sinon unit_price_gros)
  unit_price_detail: number;     // prix détails du produit (snapshot au moment de l'add)
  /** Prix gros effectif (override ou calculé via rabais tenant). null = pas de toggle dispo. */
  unit_price_gros: number | null;
  pricing_variant: 'detail' | 'gros' | null;  // null = produit sans tarif gros
  quantity: number;
};

const STORAGE_KEY = 'matix.pos.cart';

/**
 * Hook panier — état local + persistance localStorage (équivalent du "Sauv." Maas).
 * Indépendant du backend : ne sait rien des sales endpoints.
 *
 * Scope par PV : on conserve une clé séparée par point de vente pour qu'un cassier
 * puisse switcher de PV sans perdre son panier.
 */
export function useCart(pointOfSaleId: string) {
  const storageKey = pointOfSaleId ? `${STORAGE_KEY}.${pointOfSaleId}` : STORAGE_KEY;
  const [lines, setLines] = useState<CartLine[]>([]);

  // Hydrate
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? (JSON.parse(raw) as Partial<CartLine>[]) : [];
      // Migration douce : si une ligne ancienne version (sans pricing_variant) est
      // hydratée, on la complète avec des valeurs par défaut. Pas de toggle gros
      // dispo tant que le panier n'est pas reset.
      const migrated: CartLine[] = parsed.map((l) => ({
        product_id: String(l.product_id ?? ''),
        sku: String(l.sku ?? ''),
        name: String(l.name ?? ''),
        unit_price: Number(l.unit_price ?? 0),
        unit_price_detail: Number(l.unit_price_detail ?? l.unit_price ?? 0),
        unit_price_gros: l.unit_price_gros ?? null,
        pricing_variant: (l.pricing_variant as CartLine['pricing_variant']) ?? null,
        quantity: Number(l.quantity ?? 0),
      }));
      setLines(migrated.filter((l) => l.product_id));
    } catch {
      setLines([]);
    }
  }, [storageKey]);

  const persist = useCallback(
    (next: CartLine[]) => {
      setLines(next);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* quota exceeded — silently drop */
        }
      }
    },
    [storageKey],
  );

  const addProduct = useCallback(
    (product: Product, quantity = 1) => {
      const idx = lines.findIndex(
        (l) => l.product_id === product.id && l.pricing_variant !== 'gros',
      );
      // Si le produit a un tarif gros, on regroupe par (product, variant) — l'ajout
      // par défaut tape sur la ligne 'detail' existante. Cliquer "gros" sur cette
      // ligne après coup bascule sa variante sans créer de doublon.
      const detail = Number(product.unit_price);
      // On snapshote le prix gros EFFECTIF (calculé serveur : override OU rabais auto).
      // Si gros_enabled=false, effective_gros_price est null → pas de toggle.
      const gros = product.effective_gros_price !== null
        ? Number(product.effective_gros_price)
        : null;
      const variant: 'detail' | 'gros' | null = gros !== null ? 'detail' : null;
      if (idx >= 0) {
        // Existe déjà → +quantity (on garde sa variante)
        const next = [...lines];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity };
        persist(next);
      } else {
        persist([
          ...lines,
          {
            product_id: product.id,
            sku: product.sku,
            name: product.name,
            // Au premier ajout, on tape toujours sur le tarif détails — l'utilisateur bascule en gros via le segmented control si besoin
            unit_price: detail,
            unit_price_detail: detail,
            unit_price_gros: gros,
            pricing_variant: variant,
            quantity,
          },
        ]);
      }
    },
    [lines, persist],
  );

  const updateLine = useCallback(
    (idx: number, patch: Partial<CartLine>) => {
      persist(
        lines.map((l, i) => {
          if (i !== idx) return l;
          const next = { ...l, ...patch };
          // Si on bascule le variant, recalcule unit_price depuis le snapshot.
          if (patch.pricing_variant !== undefined && patch.pricing_variant !== l.pricing_variant) {
            next.unit_price = patch.pricing_variant === 'gros' && l.unit_price_gros !== null
              ? l.unit_price_gros
              : l.unit_price_detail;
          }
          return next;
        }),
      );
    },
    [lines, persist],
  );

  const removeLine = useCallback(
    (idx: number) => {
      persist(lines.filter((_, i) => i !== idx));
    },
    [lines, persist],
  );

  const clear = useCallback(() => persist([]), [persist]);

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + l.quantity * l.unit_price, 0),
    [lines],
  );

  const itemCount = useMemo(
    () => lines.reduce((s, l) => s + l.quantity, 0),
    [lines],
  );

  return {
    lines,
    addProduct,
    updateLine,
    removeLine,
    clear,
    subtotal,
    total: subtotal, // Phase 1 : pas de taxes ni remise globale
    itemCount,
  };
}
