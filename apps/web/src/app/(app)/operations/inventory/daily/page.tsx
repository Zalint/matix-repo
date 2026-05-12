'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageSpinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import {
  api,
  type DailyClosingView,
  type PointOfSale,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/**
 * Template de colonnes partage entre header et body. Modifier ici impacte les
 * deux ensembles. Minimum 200px sur "Produit", le reste fixe pour aligner.
 */
const GRID_COLS =
  'grid-cols-[minmax(200px,2fr)_110px_100px_90px_90px_100px_120px_150px_70px]';

/**
 * Hauteur estimee d'une ligne en pixels. Une ligne typique a 2 lignes de texte
 * (nom produit + sku/famille) + py-2 = ~56px. La virtualization tolere
 * legerement plus si une ligne deborde, on overscan a 5.
 */
const ROW_HEIGHT = 56;

/**
 * /operations/inventory/daily — saisie quotidienne du stock soir.
 *
 * Deux comportements selon le produit :
 *   - mode 'manuel' (defaut Boucherie) : input vide, l'utilisateur saisit ;
 *     le stock theorique est affiche a cote en gris pour comparaison.
 *   - mode 'automatique' : input pre-rempli avec le theorique, modifiable
 *     (passe en source='manual' au save). Le bouton "Recalculer auto"
 *     rafraichit toutes les valeurs auto en gardant les saisies manuelles.
 *
 * Cron de nuit : copie le stock soir J -> stock matin J+1.
 */
export default function DailyClosingPage() {
  const auth = useAuth();
  const toast = useToast();

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [pos, setPos] = useState<PointOfSale[]>([]);
  const [posId, setPosId] = useState<string>('');
  const [rows, setRows] = useState<DailyClosingView[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // Charger les PV au mount (une fois)
  useEffect(() => {
    if (!auth.ready) return;
    api.pointsOfSale
      .list(auth, { activeOnly: true })
      .then((items) => {
        setPos(items);
        if (items.length > 0 && !posId) setPosId(items[0].id);
      })
      .catch((e) => toast.error(String(e), { title: 'PV' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready]);

  // Reload quand date ou pos change
  useEffect(() => {
    if (!auth.ready || !posId) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready, date, posId]);

  async function reload() {
    if (!auth.ready || !posId) return;
    try {
      const [list, n] = await Promise.all([
        api.inventory.dailyClosing.list(auth, { date, point_of_sale_id: posId }),
        api.inventory.dailyClosing.getNote(auth, {
          date,
          point_of_sale_id: posId,
        }),
      ]);
      setRows(list);
      setDrafts(initDraftsFromRows(list));
      setNote(n?.body ?? '');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { title: 'Chargement' });
    }
  }

  function initDraftsFromRows(rs: DailyClosingView[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of rs) {
      if (r.closing) {
        out[r.product.id] = String(r.closing.quantity);
      } else if (r.product.stock_mode === 'automatique') {
        out[r.product.id] = String(Math.max(r.figures.stock_theorique, 0));
      } else {
        out[r.product.id] = '';
      }
    }
    return out;
  }

  // ---------- Actions ----------

  async function saveOne(row: DailyClosingView) {
    const draft = drafts[row.product.id];
    if (draft === undefined || draft === '') return;
    const qty = Number(draft);
    if (!Number.isFinite(qty) || qty < 0) {
      toast.warning('Quantite invalide.', { title: row.product.name });
      return;
    }
    try {
      await api.inventory.dailyClosing.setManual(auth, {
        closing_date: date,
        point_of_sale_id: posId,
        product_id: row.product.id,
        quantity: qty,
      });
      toast.success(`Stock soir enregistre : ${row.product.name}`, {
        durationMs: 2000,
      });
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), {
        title: 'Enregistrement',
      });
    }
  }

  async function saveAllManual() {
    if (!auth.ready || !posId) return;
    const targets = rows.filter((r) => {
      const d = drafts[r.product.id];
      if (d === undefined || d === '') return false;
      const cur = r.closing?.quantity ?? null;
      return cur === null || Number(d) !== cur;
    });
    if (targets.length === 0) {
      toast.info('Aucune modification a enregistrer.');
      return;
    }
    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (const r of targets) {
      try {
        await api.inventory.dailyClosing.setManual(auth, {
          closing_date: date,
          point_of_sale_id: posId,
          product_id: r.product.id,
          quantity: Number(drafts[r.product.id]),
        });
        ok++;
      } catch {
        fail++;
      }
    }
    setBusy(false);
    if (fail === 0) {
      toast.success(`${ok} ligne(s) enregistree(s).`);
    } else {
      toast.warning(`${ok} OK / ${fail} echec(s).`);
    }
    reload();
  }

  async function recomputeAuto() {
    if (!auth.ready || !posId) return;
    setBusy(true);
    try {
      const r = await api.inventory.dailyClosing.recomputeAuto(auth, {
        closing_date: date,
        point_of_sale_id: posId,
      });
      toast.success(`Recalcul auto : ${r.updated} ligne(s) mises a jour.`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), {
        title: 'Recalcul auto',
      });
    } finally {
      setBusy(false);
    }
  }

  async function toggleStockMode(row: DailyClosingView) {
    const next = row.product.stock_mode === 'manuel' ? 'automatique' : 'manuel';
    const ok = await toast.confirm({
      title: `Basculer "${row.product.name}" en mode ${next} ?`,
      message:
        next === 'automatique'
          ? 'Le systeme calculera le stock soir automatiquement (modifiable manuellement).'
          : "L'utilisateur devra saisir le stock soir chaque jour. Pas d'auto-calcul.",
      confirmLabel: `Basculer en ${next}`,
    });
    if (!ok) return;
    try {
      await api.products.setStockMode(auth, row.product.id, next);
      toast.success(`Mode mis a jour : ${row.product.name} -> ${next}`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), {
        title: 'Changement de mode',
      });
    }
  }

  async function saveNote() {
    if (!auth.ready || !posId) return;
    try {
      await api.inventory.dailyClosing.setNote(auth, {
        note_date: date,
        point_of_sale_id: posId,
        body: note,
      });
      toast.success('Note enregistree.', { durationMs: 2000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { title: 'Note' });
    }
  }

  function exportCsv() {
    const header = [
      'Produit',
      'SKU',
      'Famille',
      'Mode',
      'Stock matin',
      'Ventes',
      'Transferts in',
      'Transferts out',
      'Theorique',
      'Stock soir',
      'Source',
      'Ecart',
    ];
    const csv = [header.join(';')];
    for (const r of rows) {
      const closing = r.closing?.quantity ?? null;
      const ecart = closing !== null ? closing - r.figures.stock_theorique : null;
      csv.push(
        [
          quote(r.product.name),
          quote(r.product.sku),
          quote(r.product.category_family ?? ''),
          r.product.stock_mode,
          r.figures.stock_matin,
          r.figures.ventes_qte,
          r.figures.transferts_in,
          r.figures.transferts_out,
          r.figures.stock_theorique,
          closing ?? '',
          r.closing?.source ?? '',
          ecart ?? '',
        ].join(';'),
      );
    }
    const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-soir-${date}-${posId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Filtre "Avec activité" ----------
  // Par défaut on ne montre que les produits qui ont du stock ou un
  // mouvement aujourd'hui. Ça évite d'afficher les 140+ produits du tenant
  // dont la plupart sont à 0. Le toggle "Tous les produits" lève le filtre.
  const [showAllProducts, setShowAllProducts] = useState(false);

  const isActiveRow = (r: DailyClosingView): boolean => {
    const f = r.figures;
    return (
      f.stock_matin !== 0 ||
      f.ventes_qte !== 0 ||
      f.transferts_in !== 0 ||
      f.transferts_out !== 0 ||
      f.cuttings_in !== 0 ||
      f.cuttings_out !== 0 ||
      f.adjustments !== 0 ||
      f.retours !== 0 ||
      r.closing !== null
    );
  };

  const filteredRows = useMemo(() => {
    return showAllProducts ? rows : rows.filter(isActiveRow);
  }, [rows, showAllProducts]);

  // ---------- Virtualization ----------
  // Le tableau peut afficher des milliers de lignes (CROSS JOIN products * pos).
  // On rend uniquement les ~30 visibles a l'ecran via @tanstack/react-virtual.
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  // ---------- Stats ----------
  // Stats GLOBALES (sur tous les produits, même filtrés) pour ne pas tromper
  // l'utilisateur : "Manuels en attente: 0" alors qu'il y en a, juste cachés.
  const stats = useMemo(() => {
    let saisi = 0;
    let auto = 0;
    let pending = 0;
    let activeCount = 0;
    for (const r of rows) {
      if (isActiveRow(r)) activeCount++;
      if (!r.closing) {
        if (r.product.stock_mode === 'manuel' && isActiveRow(r)) pending++;
      } else if (r.closing.source === 'manual') saisi++;
      else auto++;
    }
    return { saisi, auto, pending, total: rows.length, activeCount };
  }, [rows]);

  if (!auth.ready) return <PageSpinner />;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Stock soir — saisie quotidienne</h2>
        <p className="text-sm text-gray-500">
          Mode <b>manuel</b> (Boucherie par defaut) : saisie obligatoire. Mode{' '}
          <b>automatique</b> : pre-rempli, modifiable. La nuit, le stock soir J
          devient le stock matin J+1.
        </p>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-gray-200 bg-white p-3">
        <div>
          <label className="block text-xs font-medium text-gray-600">Date</label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Point de vente</label>
          <select
            value={posId}
            onChange={(e) => setPosId(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm"
          >
            {pos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="flex items-center gap-2 text-xs font-medium text-gray-600 mt-5">
            <input
              type="checkbox"
              checked={showAllProducts}
              onChange={(e) => setShowAllProducts(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span>Tous les produits ({stats.total})</span>
          </label>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={recomputeAuto} disabled={busy}>
            Recalculer auto
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
            Export CSV
          </Button>
          <Button onClick={saveAllManual} disabled={busy}>
            Enregistrer modifications
          </Button>
        </div>
      </div>

      {/* Stats — toujours globales pour ne pas masquer un travail à faire */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label={showAllProducts ? 'Total produits' : 'Avec activité'}
          value={showAllProducts ? stats.total : stats.activeCount}
        />
        <StatCard label="Saisis (manuel)" value={stats.saisi} />
        <StatCard label="Auto-calculés" value={stats.auto} />
        <StatCard
          label="Manuels en attente"
          value={stats.pending}
          highlight={stats.pending > 0}
        />
      </div>

      {/* Grille virtualisee */}
      <div className="rounded-md border border-gray-200 bg-white">
        {/* Conteneur de scroll. min-width force l'apparition du scroll horizontal
            sur ecrans etroits sans casser la grille. */}
        <div
          ref={scrollParentRef}
          className="h-[640px] overflow-auto"
          role="grid"
          aria-rowcount={filteredRows.length}
        >
          <div className="min-w-[1030px]">
            {/* Header sticky : meme template de colonnes que les lignes */}
            <div
              role="row"
              className={`sticky top-0 z-10 grid ${GRID_COLS} border-b border-gray-200 bg-gray-50 text-sm`}
            >
              <Cell role="columnheader">Produit</Cell>
              <Cell role="columnheader">Mode</Cell>
              <Cell role="columnheader" align="right">Stock matin</Cell>
              <Cell role="columnheader" align="right">Ventes</Cell>
              <Cell role="columnheader" align="right">T+ / T-</Cell>
              <Cell role="columnheader" align="right">Theorique</Cell>
              <Cell role="columnheader" align="right">Stock soir</Cell>
              <Cell role="columnheader">Source / Ecart</Cell>
              <Cell role="columnheader">{' '}</Cell>
            </div>

            {/* Body virtualise */}
            {filteredRows.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                {showAllProducts
                  ? 'Aucun produit'
                  : `Aucun produit avec activité aujourd'hui sur ce PV. Coche "Tous les produits" (${stats.total}) pour voir l'ensemble.`}
              </div>
            ) : (
              <div
                style={{
                  height: totalSize,
                  position: 'relative',
                  width: '100%',
                }}
              >
                {virtualItems.map((virtual) => {
                  const r = filteredRows[virtual.index];
                  return (
                    <div
                      key={r.product.id}
                      data-index={virtual.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtual.start}px)`,
                      }}
                    >
                      <Row
                        row={r}
                        draft={drafts[r.product.id] ?? ''}
                        onChange={(v) =>
                          setDrafts((d) => ({ ...d, [r.product.id]: v }))
                        }
                        onSave={() => saveOne(r)}
                        onToggleMode={() => toggleStockMode(r)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="rounded-md border border-gray-200 bg-white p-4">
        <label className="block text-sm font-medium text-gray-700">
          Note du jour (cause des ecarts, evenements…)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Ex: Coupure de courant 14h-16h, rupture stock veau..."
          className="mt-2 w-full rounded-md border border-gray-300 bg-white p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={saveNote}>
            Enregistrer la note
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function Row({
  row,
  draft,
  onChange,
  onSave,
  onToggleMode,
}: {
  row: DailyClosingView;
  draft: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onToggleMode: () => void;
}) {
  const closing = row.closing?.quantity ?? null;
  const ecart =
    closing !== null ? closing - row.figures.stock_theorique : null;
  const tNet = row.figures.transferts_in - row.figures.transferts_out;
  const isManual = row.product.stock_mode === 'manuel';
  const rowBg = isManual && !row.closing ? 'bg-amber-50/40' : '';

  return (
    <div
      role="row"
      className={`grid ${GRID_COLS} border-b border-gray-100 text-sm ${rowBg}`}
    >
      <Cell>
        <div className="font-medium leading-tight">{row.product.name}</div>
        <div className="text-[11px] text-gray-500 leading-tight">
          {row.product.sku}
          {row.product.category_family ? ` · ${row.product.category_family}` : ''}
        </div>
      </Cell>
      <Cell>
        <button
          type="button"
          onClick={onToggleMode}
          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
            isManual
              ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
              : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
          }`}
          title="Cliquer pour basculer le mode"
        >
          {isManual ? 'manuel' : 'automatique'}
        </button>
      </Cell>
      <Cell align="right" className="tabular-nums">
        {fmt(row.figures.stock_matin)}
      </Cell>
      <Cell align="right" className="tabular-nums text-red-700">
        {fmt(row.figures.ventes_qte)}
      </Cell>
      <Cell align="right" className="tabular-nums text-cyan-700">
        {tNet > 0 ? '+' : ''}
        {fmt(tNet)}
      </Cell>
      <Cell
        align="right"
        className="tabular-nums text-gray-500"
        title="Stock theorique calcule"
      >
        {fmt(row.figures.stock_theorique)}
      </Cell>
      <Cell align="right">
        <input
          type="number"
          step="0.001"
          min="0"
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            const cur = closing;
            if (draft !== '' && (cur === null || Number(draft) !== cur)) {
              onSave();
            }
          }}
          className="h-8 w-24 rounded border border-gray-300 px-2 text-right text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </Cell>
      <Cell>
        {row.closing ? (
          <div className="flex flex-col gap-0.5">
            <span
              className={`inline-flex w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${
                row.closing.source === 'manual'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-blue-100 text-blue-800'
              }`}
            >
              {row.closing.source === 'manual' ? 'saisie' : 'auto'}
            </span>
            {ecart !== null && (
              <span
                className={`text-[10px] tabular-nums ${
                  Math.abs(ecart) < 0.001
                    ? 'text-gray-400'
                    : ecart > 0
                      ? 'text-green-700'
                      : 'text-red-700'
                }`}
              >
                ecart: {ecart > 0 ? '+' : ''}
                {fmt(ecart)}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-gray-400">—</span>
        )}
      </Cell>
      <Cell>
        <Button size="sm" variant="ghost" onClick={onSave}>
          Save
        </Button>
      </Cell>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md border bg-white p-3 ${
        highlight ? 'border-amber-300 bg-amber-50' : 'border-gray-200'
      }`}
    >
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/**
 * Cellule grille — sert pour header (role='columnheader') et body (defaut).
 * Header se distingue par font-medium + couleur grise + bordure absente.
 */
function Cell({
  children,
  className = '',
  align = 'left',
  title,
  role,
}: {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right';
  title?: string;
  role?: 'cell' | 'columnheader';
}) {
  const isHeader = role === 'columnheader';
  const alignCls = align === 'right' ? 'text-right justify-end' : 'text-left';
  const baseCls = isHeader
    ? 'font-medium text-gray-600'
    : 'text-gray-900';
  return (
    <div
      role={role ?? 'cell'}
      className={`flex flex-col justify-center px-3 py-2 ${alignCls} ${baseCls} ${className}`}
      title={title}
    >
      {children}
    </div>
  );
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) < 0.001) return '0';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

function quote(s: string): string {
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
