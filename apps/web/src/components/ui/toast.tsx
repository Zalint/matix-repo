'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

// ============================================================================
// Toast system — generic, sans dependances externes.
//
// Couvre tous les besoins UI courants :
//   - 4 variants (success / error / warning / info) + loading
//   - Auto-dismiss avec barre de progression + pause au survol
//   - Toasts persistants (durationMs: 0 ou Infinity)
//   - Bouton d'action ("Undo", "Voir", etc.)
//   - Contenu personnalise (string OU ReactNode)
//   - Manual dismiss via ID retourne (toast.dismiss(id))
//   - Update en place (toast.update(id, ...) — utile pour async)
//   - toast.promise(p, { loading, success, error }) — wrapper async
//   - Limite de stack (5 par defaut, oldest s'efface)
//   - Position configurable (top-right par defaut)
//   - Modal confirm (remplace window.confirm)
//
// Usage minimal :
//   const t = useToast();
//   t.success('Workflow active');
//   t.error('Echec', { title: 'Erreur reseau' });
//
// Usage action button :
//   t.success('Element supprime', { action: { label: 'Annuler', onClick: undo } });
//
// Usage async :
//   await t.promise(api.save(), {
//     loading: 'Enregistrement...',
//     success: 'Enregistre.',
//     error: (e) => `Echec: ${e.message}`,
//   });
//
// Usage manuel :
//   const id = t.loading('Upload...');
//   try { await upload(); t.update(id, { variant: 'success', message: 'OK' }); }
//   catch (e) { t.update(id, { variant: 'error', message: String(e) }); }
//
// Usage confirm :
//   const ok = await t.confirm({ message: 'Supprimer ?', variant: 'danger' });
// ============================================================================

export type ToastVariant = 'success' | 'error' | 'info' | 'warning' | 'loading';

export type ToastAction = {
  label: string;
  onClick: () => void;
  /** Si true (defaut), le toast se ferme apres le click. */
  closeOnClick?: boolean;
};

export type ToastInput = {
  /** Message principal (string OU ReactNode pour cas avances). */
  message: ReactNode;
  /** Titre optionnel (gras, au-dessus du message). */
  title?: string;
  /** Variant : determine couleur, icone, duree par defaut. */
  variant?: ToastVariant;
  /**
   * Duree en ms avant auto-dismiss.
   *  - undefined : duree par defaut selon variant
   *  - 0 ou Infinity : persistant (pas d'auto-dismiss, pas de barre)
   */
  durationMs?: number;
  /** Bouton d'action (ex: "Annuler"). */
  action?: ToastAction;
  /** Callback appele quand le toast est ferme (auto OU manuel). */
  onClose?: () => void;
};

export type ToastUpdate = Partial<Omit<ToastInput, 'onClose'>>;

export type ConfirmOptions = {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
};

export type ToastPosition =
  | 'top-right'
  | 'top-left'
  | 'top-center'
  | 'bottom-right'
  | 'bottom-left'
  | 'bottom-center';

type ShortOpts = {
  title?: string;
  durationMs?: number;
  action?: ToastAction;
  onClose?: () => void;
};

export type ToastApi = {
  /** API generique : retourne l'ID pour dismiss/update ulterieurs. */
  toast: (input: ToastInput) => string;
  success: (message: ReactNode, opts?: ShortOpts) => string;
  error: (message: ReactNode, opts?: ShortOpts) => string;
  info: (message: ReactNode, opts?: ShortOpts) => string;
  warning: (message: ReactNode, opts?: ShortOpts) => string;
  /** Toast loading (spinner, persistant par defaut). */
  loading: (message: ReactNode, opts?: ShortOpts) => string;
  /** Ferme un toast specifique. */
  dismiss: (id: string) => void;
  /** Ferme tous les toasts. */
  dismissAll: () => void;
  /** Met a jour un toast existant (variant, message, action, duration...). */
  update: (id: string, patch: ToastUpdate) => void;
  /** Wrapper async : affiche loading, puis success ou error. */
  promise: <T>(
    promise: Promise<T>,
    messages: {
      loading: ReactNode;
      success: ReactNode | ((value: T) => ReactNode);
      error: ReactNode | ((err: unknown) => ReactNode);
    },
  ) => Promise<T>;
  /** Modal confirm (remplace window.confirm). */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

// ----------------------------------------------------------------------------
// Provider
// ----------------------------------------------------------------------------

type ToastItem = ToastInput & {
  id: string;
  variant: ToastVariant;
  /** Resolved duration after applying defaults; 0 or Infinity = persistent. */
  effectiveDuration: number;
};

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `t_${Date.now()}_${_idCounter}`;
}

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 3500,
  info: 3500,
  warning: 5000,
  error: 6000,
  loading: 0, // persistent par defaut
};

type PendingConfirm = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

export function ToastProvider({
  children,
  position = 'top-right',
  maxStack = 5,
}: {
  children: ReactNode;
  position?: ToastPosition;
  maxStack?: number;
}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<PendingConfirm | null>(null);

  const remove = useCallback((id: string) => {
    setToasts((cur) => {
      const item = cur.find((t) => t.id === id);
      if (item?.onClose) {
        try { item.onClose(); } catch { /* swallow user errors */ }
      }
      return cur.filter((t) => t.id !== id);
    });
  }, []);

  const push = useCallback(
    (input: ToastInput): string => {
      const variant = input.variant ?? 'info';
      const requested = input.durationMs;
      const effectiveDuration =
        requested === undefined ? DEFAULT_DURATION[variant] : requested;
      const item: ToastItem = {
        ...input,
        id: nextId(),
        variant,
        effectiveDuration:
          effectiveDuration === Infinity ? 0 : Math.max(0, effectiveDuration),
      };
      setToasts((cur) => {
        const next = [...cur, item];
        // Cap stack — evict oldest if over.
        if (next.length > maxStack) {
          return next.slice(next.length - maxStack);
        }
        return next;
      });
      return item.id;
    },
    [maxStack],
  );

  const update = useCallback((id: string, patch: ToastUpdate) => {
    setToasts((cur) =>
      cur.map((t) => {
        if (t.id !== id) return t;
        const variant = patch.variant ?? t.variant;
        // When the variant changes (eg loading -> success), reset the timer
        // by recomputing effectiveDuration based on the new variant unless
        // durationMs was explicitly provided in the patch.
        const variantChanged = patch.variant !== undefined && patch.variant !== t.variant;
        let effectiveDuration = t.effectiveDuration;
        if (patch.durationMs !== undefined) {
          effectiveDuration =
            patch.durationMs === Infinity ? 0 : Math.max(0, patch.durationMs);
        } else if (variantChanged) {
          effectiveDuration = DEFAULT_DURATION[variant];
        }
        return {
          ...t,
          ...patch,
          variant,
          effectiveDuration,
        };
      }),
    );
  }, []);

  const dismissAll = useCallback(() => setToasts([]), []);

  const api: ToastApi = useMemo(() => {
    const short =
      (variant: ToastVariant) =>
      (message: ReactNode, opts?: ShortOpts): string =>
        push({
          message,
          variant,
          title: opts?.title,
          durationMs: opts?.durationMs,
          action: opts?.action,
          onClose: opts?.onClose,
        });

    return {
      toast: push,
      success: short('success'),
      error: short('error'),
      info: short('info'),
      warning: short('warning'),
      loading: short('loading'),
      dismiss: remove,
      dismissAll,
      update,
      promise: async <T,>(
        promise: Promise<T>,
        messages: {
          loading: ReactNode;
          success: ReactNode | ((value: T) => ReactNode);
          error: ReactNode | ((err: unknown) => ReactNode);
        },
      ): Promise<T> => {
        const id = push({ message: messages.loading, variant: 'loading' });
        try {
          const value = await promise;
          const msg =
            typeof messages.success === 'function'
              ? (messages.success as (v: T) => ReactNode)(value)
              : messages.success;
          update(id, { message: msg, variant: 'success' });
          return value;
        } catch (err) {
          const msg =
            typeof messages.error === 'function'
              ? (messages.error as (e: unknown) => ReactNode)(err)
              : messages.error;
          update(id, { message: msg, variant: 'error' });
          throw err;
        }
      },
      confirm: (opts: ConfirmOptions) =>
        new Promise<boolean>((resolve) => {
          setConfirmState({ ...opts, resolve });
        }),
    };
  }, [push, remove, dismissAll, update]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onClose={remove} position={position} />
      {confirmState && (
        <ConfirmDialog
          options={confirmState}
          onClose={(value) => {
            confirmState.resolve(value);
            setConfirmState(null);
          }}
        />
      )}
    </ToastContext.Provider>
  );
}

// ----------------------------------------------------------------------------
// Viewport
// ----------------------------------------------------------------------------

const POSITION_CLASSES: Record<ToastPosition, string> = {
  'top-right': 'top-0 right-0 items-end',
  'top-left': 'top-0 left-0 items-start',
  'top-center': 'top-0 left-1/2 -translate-x-1/2 items-center',
  'bottom-right': 'bottom-0 right-0 items-end',
  'bottom-left': 'bottom-0 left-0 items-start',
  'bottom-center': 'bottom-0 left-1/2 -translate-x-1/2 items-center',
};

function ToastViewport({
  toasts,
  onClose,
  position,
}: {
  toasts: ToastItem[];
  onClose: (id: string) => void;
  position: ToastPosition;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === 'undefined') return null;

  const isBottom = position.startsWith('bottom');

  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        'pointer-events-none fixed z-[9999] flex flex-col gap-2 p-4 sm:p-6',
        POSITION_CLASSES[position],
      )}
    >
      <div
        className={cn(
          'flex w-full max-w-sm flex-col gap-2',
          isBottom && 'flex-col-reverse',
        )}
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} item={t} onClose={() => onClose(t.id)} />
        ))}
      </div>
    </div>,
    document.body,
  );
}

const VARIANT_STYLES: Record<
  ToastVariant,
  { wrapper: string; icon: string; bar: string; iconChar: string }
> = {
  success: {
    wrapper: 'border-l-4 border-green-500 bg-white',
    icon: 'bg-green-100 text-green-700',
    bar: 'bg-green-500',
    iconChar: '✓',
  },
  error: {
    wrapper: 'border-l-4 border-red-500 bg-white',
    icon: 'bg-red-100 text-red-700',
    bar: 'bg-red-500',
    iconChar: '✕',
  },
  warning: {
    wrapper: 'border-l-4 border-amber-500 bg-white',
    icon: 'bg-amber-100 text-amber-700',
    bar: 'bg-amber-500',
    iconChar: '!',
  },
  info: {
    wrapper: 'border-l-4 border-blue-500 bg-white',
    icon: 'bg-blue-100 text-blue-700',
    bar: 'bg-blue-500',
    iconChar: 'i',
  },
  loading: {
    wrapper: 'border-l-4 border-gray-400 bg-white',
    icon: 'bg-gray-100 text-gray-600',
    bar: 'bg-gray-400',
    iconChar: '', // remplace par spinner
  },
};

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const styles = VARIANT_STYLES[item.variant];
  const persistent = item.effectiveDuration <= 0;
  const [closing, setClosing] = useState(false);
  const [paused, setPaused] = useState(false);

  // Track the last variant/duration so we know when to RESET the timer.
  // Updating either should restart the auto-dismiss countdown.
  const variantRef = useRef(item.variant);
  const durationRef = useRef(item.effectiveDuration);
  const startRef = useRef<number>(Date.now());
  const remainingRef = useRef<number>(item.effectiveDuration);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [progressKey, setProgressKey] = useState(0);

  const finish = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, 180);
  }, [onClose]);

  // Reset timer when variant or duration changes (eg promise resolves).
  useEffect(() => {
    const variantChanged = variantRef.current !== item.variant;
    const durationChanged = durationRef.current !== item.effectiveDuration;
    if (variantChanged || durationChanged) {
      variantRef.current = item.variant;
      durationRef.current = item.effectiveDuration;
      remainingRef.current = item.effectiveDuration;
      startRef.current = Date.now();
      setProgressKey((k) => k + 1);
    }
  }, [item.variant, item.effectiveDuration]);

  // Auto-dismiss timer with pause-on-hover. Skip entirely if persistent.
  useEffect(() => {
    if (persistent) return;
    if (paused) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      remainingRef.current -= Date.now() - startRef.current;
      return;
    }
    startRef.current = Date.now();
    timerRef.current = setTimeout(finish, Math.max(remainingRef.current, 200));
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [paused, finish, persistent, progressKey]);

  return (
    <div
      role={item.variant === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={cn(
        'pointer-events-auto relative w-full overflow-hidden rounded-lg shadow-lg ring-1 ring-black/5 transition-all',
        styles.wrapper,
        closing ? 'translate-x-2 opacity-0' : 'translate-x-0 opacity-100',
      )}
      style={{ transitionDuration: '180ms' }}
    >
      <div className="flex items-start gap-3 p-3 pr-9">
        <span
          aria-hidden
          className={cn(
            'mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-full text-sm font-bold',
            styles.icon,
          )}
        >
          {item.variant === 'loading' ? <Spinner /> : styles.iconChar}
        </span>
        <div className="min-w-0 flex-1">
          {item.title && (
            <div className="text-sm font-semibold text-gray-900">{item.title}</div>
          )}
          <div className="break-words text-sm text-gray-700">{item.message}</div>
          {item.action && (
            <button
              type="button"
              onClick={() => {
                item.action!.onClick();
                if (item.action!.closeOnClick !== false) finish();
              }}
              className="mt-1.5 inline-flex h-7 items-center rounded-md bg-gray-900 px-2.5 text-xs font-medium text-white transition hover:bg-gray-700"
            >
              {item.action.label}
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={finish}
        aria-label="Fermer"
        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
      >
        <span aria-hidden>&times;</span>
      </button>
      {/* Progress bar — hidden on persistent toasts */}
      {!persistent && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-gray-100">
          <div
            key={progressKey}
            className={cn('h-full origin-left', styles.bar)}
            style={{
              animation: paused
                ? 'none'
                : `matix-toast-progress ${item.effectiveDuration}ms linear forwards`,
            }}
          />
        </div>
      )}
      <style>{`
        @keyframes matix-toast-progress {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
        @keyframes matix-toast-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 rounded-full border-2 border-gray-300 border-t-gray-700"
      style={{ animation: 'matix-toast-spin 0.8s linear infinite' }}
    />
  );
}

// ----------------------------------------------------------------------------
// Confirm dialog (remplace window.confirm)
// ----------------------------------------------------------------------------

function ConfirmDialog({
  options,
  onClose,
}: {
  options: ConfirmOptions;
  onClose: (confirmed: boolean) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose(false);
      if (e.key === 'Enter') onClose(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!mounted || typeof document === 'undefined') return null;

  const isDanger = options.variant === 'danger';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => onClose(false)}
        aria-hidden
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl ring-1 ring-black/10">
        <div className="flex items-start gap-3 p-5">
          <span
            aria-hidden
            className={cn(
              'mt-0.5 inline-flex h-9 w-9 flex-none items-center justify-center rounded-full text-lg font-bold',
              isDanger ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600',
            )}
          >
            {isDanger ? '!' : '?'}
          </span>
          <div className="min-w-0 flex-1">
            {options.title && (
              <h3 className="text-base font-semibold text-gray-900">{options.title}</h3>
            )}
            <div className={cn('text-sm text-gray-600', options.title && 'mt-1')}>
              {options.message}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
          <button
            type="button"
            onClick={() => onClose(false)}
            className="inline-flex h-9 items-center justify-center rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {options.cancelLabel ?? 'Annuler'}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => onClose(true)}
            className={cn(
              'inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium text-white transition',
              isDanger
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-brand-600 hover:bg-brand-700',
            )}
          >
            {options.confirmLabel ?? 'Confirmer'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
