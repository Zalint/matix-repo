/**
 * Spinner — composant léger pour les états de chargement.
 *
 * 3 usages :
 *  - `<Spinner />`              : juste l'icône rotative
 *  - `<Spinner label="…" />`    : icône + label à droite (inline)
 *  - `<PageSpinner />`          : centré sur la page, pour les loadings de route
 */

import { cn } from '@/lib/utils';

type Props = {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  label?: string;
};

const SIZE_CLASSES: Record<NonNullable<Props['size']>, string> = {
  xs: 'h-3 w-3 border-[1.5px]',
  sm: 'h-4 w-4 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-8 w-8 border-[3px]',
};

export function Spinner({ className, size = 'sm', label }: Props) {
  const dim = SIZE_CLASSES[size];
  return (
    <span
      className={cn('inline-flex items-center gap-2 text-gray-600', className)}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn(
          'inline-block animate-spin rounded-full border-current border-t-transparent',
          dim,
        )}
        aria-hidden
      />
      {label && <span className="text-sm">{label}</span>}
      <span className="sr-only">Chargement…</span>
    </span>
  );
}

/**
 * Centré dans son conteneur, hauteur min ~120px. Pour les états "loading" de
 * page entière, à utiliser dans loading.tsx ou comme fallback Suspense.
 */
export function PageSpinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex min-h-[200px] items-center justify-center" role="status" aria-live="polite">
      <Spinner size="lg" label={label} className="text-brand-600" />
    </div>
  );
}
