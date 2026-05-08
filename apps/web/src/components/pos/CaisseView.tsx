'use client';

import { useState } from 'react';
import { api, type CreateSaleInput, type Customer, type PointOfSale } from '@/lib/api';
import type { AuthState } from '@/lib/auth-context';
import { useCart } from '@/lib/pos/useCart';
import { useProductCatalog } from '@/lib/pos/useProductCatalog';
import { useDailyStats } from '@/lib/pos/useDailyStats';
import { ProductsGrid } from './ProductsGrid';
import { Cart } from './Cart';
import { DailySummary } from './DailySummary';
import { PaymentModal } from './PaymentModal';

type Props = {
  auth: AuthState;
  selectedPosId: string;
  pointsOfSale: PointOfSale[];
  customers: Customer[];
  posMap: Map<string, PointOfSale>;
  customerMap: Map<string, Customer>;
  onError: (msg: string | null) => void;
  onSuccess: (msg: string | null) => void;
};

/**
 * Vue Caisse — layout 3 colonnes (POS click-to-add).
 * Self-contained : gère son cart + ses stats journalières en interne.
 */
export function CaisseView({
  auth,
  selectedPosId,
  customers,
  posMap,
  customerMap,
  onError,
  onSuccess,
}: Props) {
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');

  const catalog = useProductCatalog(auth);
  const cart = useCart(selectedPosId);
  const stats = useDailyStats(auth, { date, pointOfSaleId: selectedPosId || undefined });

  function handleValidateClick() {
    if (!selectedPosId) return onError('Choisis un point de vente avant de valider');
    if (cart.lines.length === 0) return onError('Le panier est vide');
    onError(null);
    setPaymentOpen(true);
  }

  async function handleConfirmPayment(input: {
    payments: { method: string; amount: number; reference?: string }[];
    notes?: string;
  }) {
    if (!auth.ready || !selectedPosId) return;
    setBusy(true);
    onError(null);
    onSuccess(null);
    try {
      const body: CreateSaleInput = {
        point_of_sale_id: selectedPosId,
        ...(selectedCustomerId ? { customer_id: selectedCustomerId } : {}),
        items: cart.lines.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
        })),
        payments: input.payments as CreateSaleInput['payments'],
        ...(input.notes ? { notes: input.notes } : {}),
        auto_post: true,
      };
      const sale = await api.sales.create(auth, body);
      onSuccess(
        `Vente ${sale.reference_number} validée — ${Number(sale.total).toLocaleString('fr-FR')} FCFA encaissés`,
      );
      cart.clear();
      setSelectedCustomerId('');
      setPaymentOpen(false);
      stats.reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <ProductsGrid
            products={catalog.products}
            filtered={catalog.filtered}
            categories={
              catalog.usedCategories.length > 0 ? catalog.usedCategories : catalog.categories
            }
            categoryById={catalog.categoryById}
            families={catalog.families}
            subCategories={catalog.subCategories}
            activeFamily={catalog.activeFamily}
            activeCategoryId={catalog.activeCategoryId}
            onSelectAll={catalog.selectAll}
            onSelectFamily={catalog.selectFamily}
            onSelectCategory={catalog.setActiveCategoryId}
            search={catalog.search}
            onSearchChange={catalog.setSearch}
            onPickProduct={(p) => cart.addProduct(p)}
            loading={catalog.loading}
          />
        </section>

        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <Cart
            lines={cart.lines}
            subtotal={cart.subtotal}
            total={cart.total}
            busy={busy}
            onUpdateLine={cart.updateLine}
            onRemoveLine={cart.removeLine}
            onClear={cart.clear}
            onValidate={handleValidateClick}
          />
        </section>

        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <DailySummary
            date={date}
            onDateChange={setDate}
            stats={stats.stats}
            recent={stats.recent}
            posMap={posMap}
            customerMap={customerMap}
            loading={stats.loading}
            onReload={stats.reload}
          />
        </section>
      </div>

      <PaymentModal
        open={paymentOpen}
        total={cart.total}
        customers={customers}
        selectedCustomerId={selectedCustomerId}
        onSelectedCustomerChange={setSelectedCustomerId}
        onClose={() => setPaymentOpen(false)}
        onConfirm={handleConfirmPayment}
        busy={busy}
      />
    </>
  );
}
