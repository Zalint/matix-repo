'use client';

import type { SaleLineRow } from '@/lib/api';

type Props = {
  rows: SaleLineRow[];
  loading?: boolean;
  onVoid?: (saleId: string) => void;
};

function formatXof(n: string | number) {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
}
function isoWeek(dateIso: string): number {
  // ISO 8601 week number
  const d = new Date(dateIso + 'T00:00:00Z');
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / (7 * 24 * 3600 * 1000));
}
function monthYear(dateIso: string): string {
  const d = new Date(dateIso + 'T00:00:00');
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function ddMmYyyy(dateIso: string): string {
  const [y, m, d] = dateIso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Tableau "Dernières ventes enregistrées" — une ligne par sale_item.
 * Réplique l'affichage de la Maas App index.html (Mois / Date / Semaine / PV / etc.)
 */
export function RecentSalesLinesTable({ rows, loading, onVoid }: Props) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <h3 className="text-base font-semibold">Dernières ventes enregistrées</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <Th>Mois</Th>
              <Th>Date</Th>
              <Th>Semaine</Th>
              <Th>Point de Vente</Th>
              <Th>Type de vente</Th>
              <Th>Préparation</Th>
              <Th>Catégorie</Th>
              <Th>Produit</Th>
              <Th className="text-right">Prix Unitaire</Th>
              <Th className="text-right">Nombre</Th>
              <Th className="text-right">Montant</Th>
              <Th>Nom Client</Th>
              <Th>Numéro Client</Th>
              <Th>Adresse Client</Th>
              <Th>Créance</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><Td colSpan={16} className="py-6 text-center text-gray-400">Chargement…</Td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><Td colSpan={16} className="py-6 text-center text-gray-400">Aucune vente</Td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.sale_item_id} className="hover:bg-gray-50">
                <Td>{monthYear(r.date)}</Td>
                <Td>{ddMmYyyy(r.date)}</Td>
                <Td>{isoWeek(r.date)}</Td>
                <Td>{r.point_of_sale_name}</Td>
                <Td>
                  <span className="inline-flex rounded bg-gray-700 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                    Vente
                  </span>
                </Td>
                <Td>{r.point_of_sale_name}</Td>
                <Td>{r.category_name ?? '—'}</Td>
                <Td className="font-medium text-gray-900">{r.product_name}</Td>
                <Td className="text-right">{formatXof(r.unit_price)}</Td>
                <Td className="text-right">{Number(r.quantity).toLocaleString('fr-FR')}</Td>
                <Td className="text-right font-semibold">{formatXof(r.line_total)}</Td>
                <Td>{r.customer_name ?? '—'}</Td>
                <Td>{r.customer_phone ?? '—'}</Td>
                <Td>{r.customer_address ?? '—'}</Td>
                <Td>
                  {r.is_credit ? (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                      Oui
                    </span>
                  ) : (
                    <span className="text-gray-500">Non</span>
                  )}
                </Td>
                <Td>
                  {onVoid && (
                    <button
                      type="button"
                      aria-label="Annuler vente"
                      onClick={() => onVoid(r.sale_id)}
                      className="grid h-6 w-8 place-items-center rounded bg-red-500 text-xs text-white hover:bg-red-600"
                      title={`Annuler vente ${r.reference_number ?? ''}`}
                    >
                      −
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`whitespace-nowrap px-3 py-2 text-left font-medium ${className}`}>{children}</th>
  );
}
function Td({
  children,
  className = '',
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`whitespace-nowrap px-3 py-2 align-top ${className}`}>
      {children}
    </td>
  );
}
