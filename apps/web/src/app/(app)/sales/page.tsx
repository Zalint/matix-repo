'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, type Customer, type PointOfSale } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { PosTopbar } from '@/components/pos/PosTopbar';
import { CaisseView } from '@/components/pos/CaisseView';
import { StandardView } from '@/components/pos/StandardView';
import type { PosView } from '@/components/pos/PosViewSwitcher';

/**
 * /sales — Caisse / POS
 *
 * Orchestrateur : choisit la vue (Caisse 3-col ou Standard form-based) et
 * partage le contexte commun (PV + customers) entre les deux.
 *
 * Chaque vue est un composant indépendant qui gère son propre état interne.
 */
export default function SalesPosPage() {
  const auth = useAuth();

  const [view, setView] = useState<PosView>('caisse');
  const [pos, setPos] = useState<PointOfSale[]>([]);
  const [selectedPosId, setSelectedPosId] = useState<string>('');
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.ready) return;
    Promise.all([api.pointsOfSale.list(auth, { activeOnly: true }), api.customers.list(auth)])
      .then(([ps, cs]) => {
        setPos(ps);
        setCustomers(cs);
        if (ps.length === 1) setSelectedPosId(ps[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [auth]);

  const posMap = useMemo(() => new Map(pos.map((p) => [p.id, p])), [pos]);
  const customerMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  if (!auth.ready) return <div className="text-sm text-gray-500">Chargement…</div>;

  return (
    <div
      className={
        view === 'caisse'
          ? 'flex h-[calc(100vh-7rem)] flex-col gap-3'
          : 'flex flex-col gap-3'
      }
    >
      <PosTopbar
        pointsOfSale={pos}
        selectedPosId={selectedPosId}
        onSelectedPosChange={setSelectedPosId}
        view={view}
        onViewChange={setView}
      />

      {error && <div className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-md bg-green-50 p-2 text-sm text-green-700">{success}</div>}

      {view === 'caisse' ? (
        <CaisseView
          auth={auth}
          selectedPosId={selectedPosId}
          pointsOfSale={pos}
          customers={customers}
          posMap={posMap}
          customerMap={customerMap}
          onError={setError}
          onSuccess={setSuccess}
        />
      ) : (
        <StandardView
          auth={auth}
          selectedPosId={selectedPosId}
          onSelectedPosChange={setSelectedPosId}
          pointsOfSale={pos}
          customers={customers}
          onError={setError}
          onSuccess={setSuccess}
        />
      )}
    </div>
  );
}
