'use client';

import type { PointOfSale } from '@/lib/api';
import { PosViewSwitcher, type PosView } from './PosViewSwitcher';

type Props = {
  pointsOfSale: PointOfSale[];
  selectedPosId: string;
  onSelectedPosChange: (id: string) => void;
  view: PosView;
  onViewChange: (v: PosView) => void;
};

export function PosTopbar({
  pointsOfSale,
  selectedPosId,
  onSelectedPosChange,
  view,
  onViewChange,
}: Props) {
  const today = new Date();
  const dateLabel = today.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const timeLabel = today.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-red-600 px-4 py-3 text-white">
      <div className="flex items-center gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <span aria-hidden>🛒</span> Caisse
        </h2>
        <PosViewSwitcher view={view} onViewChange={onViewChange} />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="pos-select" className="text-xs font-medium opacity-90">
            Point de vente :
          </label>
          <select
            id="pos-select"
            value={selectedPosId}
            onChange={(e) => onSelectedPosChange(e.target.value)}
            className="h-9 rounded-md border-0 bg-white px-3 text-sm font-medium text-gray-900"
          >
            <option value="">— Choisir —</option>
            {pointsOfSale.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="text-xs opacity-90">
          <span>{dateLabel}</span>
          <span className="mx-1">à</span>
          <span>{timeLabel}</span>
        </div>
      </div>
    </div>
  );
}
