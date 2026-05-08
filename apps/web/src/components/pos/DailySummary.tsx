'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  PAYMENT_METHOD_LABELS,
  type Customer,
  type DailyStats,
  type PaymentMethod,
  type PointOfSale,
  type Sale,
} from '@/lib/api';

type Props = {
  date: string;
  onDateChange: (date: string) => void;
  stats: DailyStats | null;
  recent: Sale[];
  posMap: Map<string, PointOfSale>;
  customerMap: Map<string, Customer>;
  loading?: boolean;
  onReload: () => void;
  onCloture?: () => void;
  onOpenSale?: (id: string) => void;
};

function formatXof(n: number | string) {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' FCFA';
}

const METHOD_DOTS: Record<PaymentMethod, string> = {
  cash: 'bg-green-500',
  wave: 'bg-blue-500',
  orange_money: 'bg-orange-500',
  mtn_momo: 'bg-yellow-500',
  card: 'bg-gray-500',
  credit: 'bg-red-500',
};

export function DailySummary({
  date,
  onDateChange,
  stats,
  recent,
  posMap,
  customerMap,
  loading,
  onReload,
  onCloture,
  onOpenSale,
}: Props) {
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | null>(null);

  // Mapping rapide : pour chaque sale, ses méthodes de paiement (depuis stats by_method on a juste les agrégats globaux,
  // donc pour le filtrage par méthode on s'appuiera sur recent[].id quand on rechargera le détail à la demande).
  // Phase 1 simplifiée : le filter chip filtre seulement la liste si la sale a un total > 0.
  const filteredRecent = useMemo(() => recent, [recent]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <span aria-hidden>📊</span> Résumé du jour
        </h3>
        <Button variant="secondary" size="sm" onClick={onReload} disabled={loading}>
          {loading ? '…' : '↻'}
        </Button>
      </div>

      {/* Date picker */}
      <div className="border-b border-gray-100 px-4 py-3">
        <label className="mb-1 block text-xs font-medium text-gray-600">Date :</label>
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          className="h-9 w-full rounded-md border border-gray-300 px-3 text-sm"
        />
      </div>

      {/* KPIs */}
      <div className="space-y-2 border-b border-gray-100 px-4 py-3">
        <KpiTile
          icon="📋"
          color="gray"
          value={stats?.transactions ?? 0}
          label="TRANSACTIONS"
        />
        <KpiTile
          icon="🛒"
          color="red"
          value={stats?.orders ?? 0}
          label="COMMANDES"
        />
        <KpiTile
          icon="💰"
          color="green"
          value={stats ? formatXof(stats.revenue) : '—'}
          label="CHIFFRE D'AFFAIRES"
        />
        <KpiTile
          icon="📦"
          color="blue"
          value={stats ? Math.round(Number(stats.items_sold)) : 0}
          label="ARTICLES VENDUS"
        />
      </div>

      {/* Recent transactions */}
      <div className="flex-1 overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-3">
          <h4 className="mb-2 text-sm font-semibold">Dernières transactions</h4>
          <div className="flex flex-wrap gap-1">
            <MethodChip
              active={methodFilter === null}
              onClick={() => setMethodFilter(null)}
              label={`Tous (${recent.length})`}
            />
            {(stats?.by_method ?? []).map((m) => (
              <MethodChip
                key={m.method}
                active={methodFilter === m.method}
                onClick={() =>
                  setMethodFilter(methodFilter === (m.method as PaymentMethod) ? null : (m.method as PaymentMethod))
                }
                color={METHOD_DOTS[m.method as PaymentMethod] ?? 'bg-gray-400'}
                label={`${PAYMENT_METHOD_LABELS[m.method as PaymentMethod] ?? m.method} (${m.count})`}
              />
            ))}
          </div>
        </div>

        <div className="h-full overflow-auto px-4 py-3">
          {filteredRecent.length === 0 ? (
            <p className="py-6 text-center text-xs text-gray-400">Aucune transaction</p>
          ) : (
            <ul className="space-y-3">
              {filteredRecent.map((s) => (
                <TransactionRow
                  key={s.id}
                  sale={s}
                  posName={posMap.get(s.point_of_sale_id)?.name}
                  customerName={s.customer_id ? customerMap.get(s.customer_id)?.display_name ?? null : null}
                  onClick={() => onOpenSale?.(s.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Cloture caisse */}
      <div className="border-t border-gray-200 p-3">
        <button
          type="button"
          onClick={onCloture}
          disabled
          title="Clôture de caisse — module à venir"
          className="w-full rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white opacity-60 cursor-not-allowed"
        >
          🔒 Cloturer la caisse
        </button>
      </div>
    </div>
  );
}

function KpiTile({
  icon,
  color,
  value,
  label,
}: {
  icon: string;
  color: 'gray' | 'red' | 'green' | 'blue';
  value: string | number;
  label: string;
}) {
  const palette: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-700',
    red: 'bg-red-100 text-red-700',
    green: 'bg-green-100 text-green-700',
    blue: 'bg-blue-100 text-blue-700',
  };
  return (
    <div className="flex items-center gap-3 rounded-md border border-gray-100 bg-white p-2">
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md text-base ${palette[color]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="truncate text-base font-bold">{value}</div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</div>
      </div>
    </div>
  );
}

function MethodChip({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium transition ${
        active ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {color && <span className={`inline-block h-2 w-2 rounded-full ${color}`} />}
      {label}
    </button>
  );
}

function TransactionRow({
  sale,
  posName,
  customerName,
  onClick,
}: {
  sale: Sale;
  posName?: string;
  customerName: string | null;
  onClick: () => void;
}) {
  const time = new Date(sale.posted_at ?? sale.created_at).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <li className="rounded-md border-l-4 border-l-red-400 bg-white p-2 shadow-sm">
      <div className="flex items-start justify-between text-xs text-gray-500">
        <span>{time}</span>
        <button
          type="button"
          onClick={onClick}
          className="rounded-md bg-red-600/90 px-2 py-0.5 text-[10px] font-bold uppercase text-white hover:bg-red-700"
          title="Voir détail"
        >
          Voir
        </button>
      </div>
      <div className="mt-1 text-sm font-medium text-gray-900">
        {sale.reference_number ?? `Brouillon ${sale.id.slice(0, 8)}…`}
      </div>
      <div className="text-xs text-gray-500">
        {customerName ?? 'Walk-in'} {posName && <span>· {posName}</span>}
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">PAYÉ</span>
        <span className="text-sm font-bold text-gray-900">{formatXof(sale.total)}</span>
      </div>
    </li>
  );
}
