'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type DailyStats, type Sale } from '@/lib/api';
import type { AuthState } from '@/lib/auth-context';

/**
 * Hook stats journalières — KPIs + dernières ventes pour le panneau "Résumé du jour".
 * Filtre par date + point de vente.
 */
export function useDailyStats(
  auth: AuthState,
  opts: { date: string; pointOfSaleId?: string },
) {
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [recent, setRecent] = useState<Sale[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!auth.ready) return;
    setLoading(true);
    setError(null);
    try {
      const [s, r] = await Promise.all([
        api.sales.dailyStats(auth, { date: opts.date, point_of_sale_id: opts.pointOfSaleId }),
        api.sales.list(auth, { status: 'posted', limit: 20 }),
      ]);
      setStats(s);
      // Filtre côté client par date + PV si nécessaire (le backend list ne filtre pas par date)
      setRecent(
        r.filter((sale) => {
          if (sale.posted_at?.slice(0, 10) !== opts.date) return false;
          if (opts.pointOfSaleId && sale.point_of_sale_id !== opts.pointOfSaleId) return false;
          return true;
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [auth, opts.date, opts.pointOfSaleId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { stats, recent, loading, error, reload };
}
