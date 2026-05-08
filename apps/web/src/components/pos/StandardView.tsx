'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type CreateSaleInput,
  type Customer,
  type PointOfSale,
  type SaleLineRow,
} from '@/lib/api';
import type { AuthState } from '@/lib/auth-context';
import { useProductCatalog } from '@/lib/pos/useProductCatalog';
import { StandardSalesForm } from './StandardSalesForm';
import { RecentSalesLinesTable } from './RecentSalesLinesTable';

type Props = {
  auth: AuthState;
  selectedPosId: string;
  onSelectedPosChange: (id: string) => void;
  pointsOfSale: PointOfSale[];
  customers: Customer[];
  onError: (msg: string | null) => void;
  onSuccess: (msg: string | null) => void;
};

/**
 * Vue Standard — formulaire de saisie + tableau des dernières ventes (lignes flat).
 * Réplique le comportement de la Maas App index.html.
 */
export function StandardView({
  auth,
  selectedPosId,
  onSelectedPosChange,
  pointsOfSale,
  customers,
  onError,
  onSuccess,
}: Props) {
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<SaleLineRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);

  const catalog = useProductCatalog(auth);

  const reloadRows = useCallback(async () => {
    if (!auth.ready) return;
    setLoadingRows(true);
    try {
      const r = await api.sales.lines(auth, {
        ...(selectedPosId ? { point_of_sale_id: selectedPosId } : {}),
        limit: 100,
      });
      setRows(r);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRows(false);
    }
  }, [auth, selectedPosId, onError]);

  useEffect(() => {
    reloadRows();
  }, [reloadRows]);

  async function handleSubmit(input: {
    date: string;
    point_of_sale_id: string;
    customer_id: string | null;
    is_credit: boolean;
    lines: Array<{ product_id: string; quantity: number; unit_price: number }>;
  }) {
    if (!auth.ready) return;
    setBusy(true);
    onError(null);
    onSuccess(null);
    try {
      const total = input.lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
      const body: CreateSaleInput = {
        point_of_sale_id: input.point_of_sale_id,
        ...(input.customer_id ? { customer_id: input.customer_id } : {}),
        items: input.lines.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
        })),
        // Phase 1 : le mode Standard auto-encaisse — cash si pas de créance, credit sinon.
        // Le backend accepte les 2 méthodes ; reconciliation pourra distinguer plus tard.
        payments: [
          {
            method: input.is_credit ? 'credit' : 'cash',
            amount: total,
          },
        ],
        // notes peut servir à stocker la date back-entry si différente d'aujourd'hui (Phase 2).
        notes: input.date !== new Date().toISOString().slice(0, 10) ? `Saisie back-date ${input.date}` : undefined,
        auto_post: true,
      };
      const sale = await api.sales.create(auth, body);
      onSuccess(
        `Vente ${sale.reference_number} enregistrée — ${Number(sale.total).toLocaleString('fr-FR')} FCFA${input.is_credit ? ' (créance)' : ''}`,
      );
      reloadRows();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleVoidSale(saleId: string) {
    const reason = window.prompt('Raison de l’annulation (min. 5 caractères) :');
    if (!reason || reason.trim().length < 5) return;
    onError(null);
    try {
      await api.sales.void(auth, saleId, reason.trim());
      onSuccess('Vente annulée — stock recrédité');
      reloadRows();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6 overflow-auto">
      <StandardSalesForm
        date={date}
        onDateChange={setDate}
        pointsOfSale={pointsOfSale}
        selectedPosId={selectedPosId}
        onSelectedPosChange={onSelectedPosChange}
        customers={customers}
        products={catalog.products}
        categories={
          catalog.usedCategories.length > 0 ? catalog.usedCategories : catalog.categories
        }
        busy={busy}
        onSubmit={handleSubmit}
      />

      <RecentSalesLinesTable rows={rows} loading={loadingRows} onVoid={handleVoidSale} />
    </div>
  );
}
