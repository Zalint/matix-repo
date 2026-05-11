'use client';

import { Button } from '@/components/ui/button';
import type { CartLine } from '@/lib/pos/useCart';

type Props = {
  lines: CartLine[];
  subtotal: number;
  total: number;
  busy?: boolean;
  onUpdateLine: (idx: number, patch: Partial<CartLine>) => void;
  onRemoveLine: (idx: number) => void;
  onClear: () => void;
  onValidate: () => void;
  onPreorder?: () => void;
  onSave?: () => void;
};

function formatXof(n: number | string) {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' FCFA';
}

export function Cart({
  lines,
  subtotal,
  total,
  busy,
  onUpdateLine,
  onRemoveLine,
  onClear,
  onValidate,
  onPreorder,
  onSave,
}: Props) {
  const isEmpty = lines.length === 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header avec actions */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <span aria-hidden>🛒</span> Panier
        </h3>
        <div className="flex items-center gap-2">
          <ActionPill
            color="amber"
            disabled
            title="Pré-commande — module à venir"
            onClick={onPreorder}
          >
            Pré-co
          </ActionPill>
          <ActionPill color="gray" onClick={onClear} disabled={isEmpty || busy}>
            Vider
          </ActionPill>
          <ActionPill
            color="gray"
            disabled
            title="Sauvegarder — la persistance auto est déjà active"
            onClick={onSave}
          >
            Sauv.
          </ActionPill>
          <ActionPill color="red" onClick={onValidate} disabled={isEmpty || busy}>
            Valider
          </ActionPill>
        </div>
      </div>

      {/* Lines */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="text-5xl text-gray-300" aria-hidden>🛒</div>
            <p className="text-sm font-medium text-gray-500">Votre panier est vide</p>
            <p className="text-xs text-gray-400">
              Sélectionnez des produits pour commencer
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {lines.map((l, i) => (
              <li
                key={`${l.product_id}-${l.pricing_variant ?? 'simple'}-${i}`}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border border-gray-100 bg-gray-50 p-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{l.name}</div>
                  <div className="text-xs text-gray-500">
                    {formatXof(l.unit_price)} × {l.quantity}
                  </div>
                  {/* Segmented control détails / gros — visible uniquement si le produit a 2 tarifs */}
                  {l.pricing_variant !== null && l.unit_price_gros !== null && (
                    <div className="mt-1.5 inline-flex overflow-hidden rounded-md border border-brand-300 text-[10px] font-medium">
                      <button
                        type="button"
                        onClick={() => onUpdateLine(i, { pricing_variant: 'detail' })}
                        className={
                          l.pricing_variant === 'detail'
                            ? 'bg-brand-600 px-2 py-0.5 text-white'
                            : 'bg-white px-2 py-0.5 text-brand-800 hover:bg-brand-50'
                        }
                      >
                        détails · {formatXof(l.unit_price_detail)}
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateLine(i, { pricing_variant: 'gros' })}
                        className={
                          l.pricing_variant === 'gros'
                            ? 'bg-brand-600 px-2 py-0.5 text-white'
                            : 'bg-white px-2 py-0.5 text-brand-800 hover:bg-brand-50'
                        }
                      >
                        gros · {formatXof(l.unit_price_gros)}
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="−1"
                    onClick={() =>
                      l.quantity <= 1
                        ? onRemoveLine(i)
                        : onUpdateLine(i, { quantity: l.quantity - 1 })
                    }
                    className="grid h-7 w-7 place-items-center rounded-md border border-gray-300 bg-white text-sm hover:bg-gray-100"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={l.quantity}
                    onChange={(e) =>
                      onUpdateLine(i, { quantity: Math.max(0, Number(e.target.value)) })
                    }
                    className="h-7 w-14 rounded-md border border-gray-300 bg-white text-center text-xs"
                  />
                  <button
                    type="button"
                    aria-label="+1"
                    onClick={() => onUpdateLine(i, { quantity: l.quantity + 1 })}
                    className="grid h-7 w-7 place-items-center rounded-md border border-gray-300 bg-white text-sm hover:bg-gray-100"
                  >
                    +
                  </button>
                </div>
                <div className="flex flex-col items-end">
                  <div className="text-sm font-semibold text-gray-900">
                    {formatXof(l.quantity * l.unit_price)}
                  </div>
                  <button
                    type="button"
                    aria-label="Retirer"
                    onClick={() => onRemoveLine(i)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Retirer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pré-commandes link (placeholder) */}
      <div className="border-t border-gray-100 px-4 py-2">
        <button
          type="button"
          disabled
          className="w-full rounded-md border border-red-200 bg-red-50/50 px-3 py-2 text-xs font-medium text-red-700 opacity-60 cursor-not-allowed"
          title="Pré-commandes — module à venir"
        >
          👁 Voir Pré-commandes
        </button>
      </div>

      {/* Totaux */}
      <div className="border-t border-gray-200 px-4 py-3">
        <div className="flex justify-between text-sm text-gray-600">
          <span>Sous-total :</span>
          <span>{formatXof(subtotal)}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-base font-semibold">Total :</span>
          <span className="text-2xl font-bold text-red-600">{formatXof(total)}</span>
        </div>
      </div>
    </div>
  );
}

function ActionPill({
  color,
  onClick,
  disabled,
  title,
  children,
}: {
  color: 'red' | 'amber' | 'gray';
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  const palette: Record<string, string> = {
    red: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
    amber: 'bg-amber-500 text-white hover:bg-amber-600 disabled:bg-amber-300',
    gray: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed ${palette[color]}`}
    >
      {children}
    </button>
  );
}
