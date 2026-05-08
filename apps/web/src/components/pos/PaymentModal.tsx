'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PAYMENT_METHOD_LABELS, type Customer, type PaymentMethod } from '@/lib/api';

type PaymentDraft = { method: PaymentMethod; amount: number; reference?: string };

const METHODS: PaymentMethod[] = ['cash', 'wave', 'orange_money', 'mtn_momo', 'card', 'credit'];

type Props = {
  open: boolean;
  total: number;
  customers: Customer[];
  selectedCustomerId: string;
  onSelectedCustomerChange: (id: string) => void;
  onClose: () => void;
  onConfirm: (input: { payments: PaymentDraft[]; notes?: string }) => Promise<void> | void;
  busy?: boolean;
};

function formatXof(n: number | string) {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' FCFA';
}

export function PaymentModal({
  open,
  total,
  customers,
  selectedCustomerId,
  onSelectedCustomerChange,
  onClose,
  onConfirm,
  busy,
}: Props) {
  const [payments, setPayments] = useState<PaymentDraft[]>([{ method: 'cash', amount: total }]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Resync amount when total changes
  useEffect(() => {
    if (!open) return;
    setPayments([{ method: 'cash', amount: total }]);
    setNotes('');
    setError(null);
  }, [open, total]);

  const paid = useMemo(
    () => payments.reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0),
    [payments],
  );
  const change = Math.max(0, paid - total);
  const remaining = Math.max(0, total - paid);

  if (!open) return null;

  function update(idx: number, patch: Partial<PaymentDraft>) {
    setPayments((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function add() {
    setPayments((prev) => [...prev, { method: 'cash', amount: remaining > 0 ? remaining : 0 }]);
  }
  function remove(idx: number) {
    setPayments((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const cleaned = payments
      .filter((p) => Number.isFinite(p.amount) && p.amount > 0)
      .map((p) => ({
        method: p.method,
        amount: Number(p.amount),
        ...(p.reference?.trim() ? { reference: p.reference.trim() } : {}),
      }));
    if (cleaned.length === 0) return setError('Au moins un paiement requis');
    if (paid < total) return setError(`Payé ${formatXof(paid)} < total ${formatXof(total)}`);
    try {
      await onConfirm({ payments: cleaned, ...(notes.trim() ? { notes: notes.trim() } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
      >
        <h3 className="text-lg font-semibold">Encaisser</h3>
        <p className="text-sm text-gray-500">Total à régler : <span className="font-bold text-gray-900">{formatXof(total)}</span></p>

        {error && <div className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</div>}

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Client (optionnel)</label>
            <select
              value={selectedCustomerId}
              onChange={(e) => onSelectedCustomerChange(e.target.value)}
              className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
            >
              <option value="">— Walk-in —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.display_name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-600">Paiements</span>
              <button
                type="button"
                onClick={add}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                + Ajouter
              </button>
            </div>
            {payments.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_120px_auto] items-end gap-2">
                <select
                  value={p.method}
                  onChange={(e) => update(i, { method: e.target.value as PaymentMethod })}
                  className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={p.amount}
                  onChange={(e) => update(i, { amount: Number(e.target.value) })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(i)}
                  disabled={payments.length === 1}
                  aria-label="Retirer paiement"
                >
                  ×
                </Button>
              </div>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Notes (optionnel)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Référence interne, mémo cassier…"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-1 border-t pt-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-600">Payé :</span><span className="font-medium">{formatXof(paid)}</span></div>
            {remaining > 0 && (
              <div className="flex justify-between text-red-700"><span>Reste :</span><span>{formatXof(remaining)}</span></div>
            )}
            {change > 0 && (
              <div className="flex justify-between text-green-700"><span>Rendu :</span><span>{formatXof(change)}</span></div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy || paid < total}>
            {busy ? 'En cours…' : 'Encaisser'}
          </Button>
        </div>
      </form>
    </div>
  );
}
