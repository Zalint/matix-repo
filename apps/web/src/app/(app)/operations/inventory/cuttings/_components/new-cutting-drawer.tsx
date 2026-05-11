'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, type Product } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type Draft = {
  product_id: string;
  quantity: string;
};

/**
 * Drawer "Nouvelle découpe".
 *
 * Source en haut (produit + quantité). Sorties en bas (1 ligne par produit fini).
 * Bilan en bas avec calcul live de la chute. Au save, appelle l'API qui crée
 * tout en une transaction (header + outputs + 1 cutting_out + N cutting_in).
 */
export function NewCuttingDrawer({
  posId,
  products,
  onClose,
  onSaved,
}: {
  posId: string;
  products: Product[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const auth = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const [sourceId, setSourceId] = useState<string>(products[0]?.id ?? '');
  const [sourceQty, setSourceQty] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([
    { product_id: '', quantity: '' },
  ]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Calculs live
  const src = Number(sourceQty) || 0;
  const totals = useMemo(() => {
    const sumOutputs = drafts.reduce((s, d) => s + (Number(d.quantity) || 0), 0);
    const waste = src - sumOutputs;
    const wastePct = src > 0 ? (waste / src) * 100 : 0;
    return { sumOutputs, waste, wastePct };
  }, [drafts, src]);

  const wasteHigh = totals.wastePct > 25;
  const wasteInvalid = totals.waste < 0;

  function setDraft(i: number, patch: Partial<Draft>) {
    setDrafts((arr) => arr.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }
  function addRow() {
    setDrafts((arr) => [...arr, { product_id: '', quantity: '' }]);
  }
  function removeRow(i: number) {
    setDrafts((arr) => arr.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    if (!sourceId) {
      toast.warning('Sélectionne un produit source.');
      return;
    }
    if (src <= 0) {
      toast.warning('La quantité source doit être positive.');
      return;
    }
    const cleanOutputs = drafts
      .filter((d) => d.product_id && Number(d.quantity) > 0)
      .map((d) => ({ product_id: d.product_id, quantity: Number(d.quantity) }));
    if (cleanOutputs.length === 0) {
      toast.warning('Ajoute au moins une sortie avec une quantité.');
      return;
    }
    if (wasteInvalid) {
      toast.error(
        `Sortie ${fmt(totals.sumOutputs)} kg > source ${fmt(src)} kg. Ajuste les quantités.`,
        { title: 'Chute négative' },
      );
      return;
    }
    // Doublons de product_id
    const seen = new Set<string>();
    for (const o of cleanOutputs) {
      if (seen.has(o.product_id)) {
        const p = productMap.get(o.product_id);
        toast.error(
          `Le produit ${p?.name ?? o.product_id} apparaît plusieurs fois. Regroupe les quantités.`,
          { title: 'Doublon' },
        );
        return;
      }
      seen.add(o.product_id);
    }
    if (cleanOutputs.some((o) => o.product_id === sourceId)) {
      toast.error("Le produit source ne peut pas être aussi en sortie.", {
        title: 'Source = sortie',
      });
      return;
    }

    setBusy(true);
    try {
      await api.inventory.cuttings.create(auth, {
        point_of_sale_id: posId,
        source_product_id: sourceId,
        source_quantity: src,
        outputs: cleanOutputs,
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { title: 'Enregistrement' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/30"
        onClick={() => !busy && onClose()}
        aria-label="Fermer"
      />
      {/* Panel */}
      <aside className="flex w-full max-w-2xl flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <h3 className="text-lg font-semibold">Nouvelle découpe</h3>
            <p className="text-xs text-gray-500">
              Le système calcule la chute et crée les mouvements de stock.
            </p>
          </div>
          <button
            onClick={() => !busy && onClose()}
            className="text-2xl leading-none text-gray-400 hover:text-gray-700"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Source */}
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Source (matière première)
            </div>
            <div className="grid grid-cols-[1fr_140px] gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600">Produit</label>
                <select
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
                >
                  <option value="">— sélectionner —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">Quantité (kg)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={sourceQty}
                  onChange={(e) => setSourceQty(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-right text-sm tabular-nums"
                />
              </div>
            </div>
            <div className="mt-1 text-[11px] text-gray-500">
              La source sera décrémentée (mouvement <code className="rounded bg-gray-100 px-1">cutting_out</code>) à l'enregistrement.
            </div>
          </div>

          {/* Sorties */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Sorties (produits finis)
              </div>
              <button
                type="button"
                onClick={addRow}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                + ajouter une sortie
              </button>
            </div>
            <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {drafts.length === 0 && (
                <div className="px-3 py-3 text-center text-xs text-gray-400">
                  Aucune sortie. Clique sur "+ ajouter une sortie".
                </div>
              )}
              {drafts.map((d, i) => {
                const pct = src > 0 && d.quantity
                  ? ((Number(d.quantity) / src) * 100).toFixed(1)
                  : '0,0';
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_120px_60px_40px] items-center gap-3 px-3 py-2"
                  >
                    <select
                      value={d.product_id}
                      onChange={(e) => setDraft(i, { product_id: e.target.value })}
                      className="h-8 rounded border border-gray-300 bg-white px-2 text-sm"
                    >
                      <option value="">— produit —</option>
                      {products
                        .filter((p) => p.id !== sourceId)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      placeholder="kg"
                      value={d.quantity}
                      onChange={(e) => setDraft(i, { quantity: e.target.value })}
                      className="h-8 rounded border border-gray-300 px-2 text-right text-sm tabular-nums"
                    />
                    <div className="text-right text-xs tabular-nums text-gray-500">{pct} %</div>
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="text-lg leading-none text-gray-400 hover:text-red-600"
                      aria-label="Supprimer la ligne"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bilan live */}
          <div className="space-y-1.5 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm tabular-nums">
            <div className="flex justify-between">
              <span className="text-gray-600">Source</span>
              <span>{fmt(src)} kg</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Total sorties</span>
              <span>{fmt(totals.sumOutputs)} kg</span>
            </div>
            <div className="flex justify-between border-t border-gray-200 pt-1.5">
              <span className="font-medium">Chute</span>
              <span
                className={`font-semibold ${
                  wasteInvalid
                    ? 'text-red-700'
                    : wasteHigh
                      ? 'text-amber-900'
                      : 'text-gray-700'
                }`}
              >
                {fmt(totals.waste)} kg · {totals.wastePct.toFixed(1)} %
              </span>
            </div>
            {wasteInvalid && (
              <div className="mt-1 text-[11px] text-red-700">
                ⚠ Les sorties dépassent la source. Réduis les quantités.
              </div>
            )}
            {!wasteInvalid && wasteHigh && (
              <div className="mt-1 text-[11px] text-amber-800">
                ⚠ Chute supérieure à 25 %. Vérifie ou laisse une note explicative.
              </div>
            )}
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-medium text-gray-600">Note (facultatif)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Ex: carcasse pleine d'os, pas de filet utilisable"
              className="mt-1 w-full rounded-md border border-gray-300 bg-white p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-5 py-3">
          <div className="text-xs text-gray-500">
            Crée <b>1</b> mouvement <code className="rounded bg-gray-200 px-1">cutting_out</code>
            {' + '}
            <b>{drafts.filter((d) => d.product_id && Number(d.quantity) > 0).length}</b>
            {' '}
            <code className="rounded bg-gray-200 px-1">cutting_in</code> (transaction).
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={busy || wasteInvalid}>
              {busy ? 'Enregistrement…' : 'Enregistrer la découpe'}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) < 0.001) return '0';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}
