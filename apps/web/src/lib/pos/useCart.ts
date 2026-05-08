'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Product } from '@/lib/api';

export type CartLine = {
  product_id: string;
  sku: string;
  name: string;
  unit_price: number;
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
      setLines(raw ? (JSON.parse(raw) as CartLine[]) : []);
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
      const idx = lines.findIndex((l) => l.product_id === product.id);
      if (idx >= 0) {
        // Existe déjà → +quantity
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
            unit_price: Number(product.unit_price),
            quantity,
          },
        ]);
      }
    },
    [lines, persist],
  );

  const updateLine = useCallback(
    (idx: number, patch: Partial<CartLine>) => {
      persist(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
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
