'use client';

export type PosView = 'caisse' | 'standard';

type Props = {
  view: PosView;
  onViewChange: (v: PosView) => void;
};

/**
 * Bascule entre le mode "Caisse" (3 colonnes, click-to-add) et "Standard" (formulaire à plat).
 * Réplique le toggle Web/Standard de la Maas App, dans un seul composant.
 */
export function PosViewSwitcher({ view, onViewChange }: Props) {
  return (
    <div role="tablist" aria-label="Mode de saisie" className="inline-flex rounded-md bg-white/15 p-1">
      <Tab active={view === 'caisse'} onClick={() => onViewChange('caisse')} icon="🛒">
        Caisse
      </Tab>
      <Tab active={view === 'standard'} onClick={() => onViewChange('standard')} icon="📋">
        Standard
      </Tab>
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition ${
        active ? 'bg-white text-red-700 shadow-sm' : 'text-white/90 hover:bg-white/10'
      }`}
    >
      <span aria-hidden>{icon}</span>
      {children}
    </button>
  );
}
