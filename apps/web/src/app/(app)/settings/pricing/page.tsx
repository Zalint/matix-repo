'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/**
 * /settings/pricing — settings tarifaires au niveau tenant.
 *
 * Pour l'instant un seul paramètre : le rabais "vente en gros" par défaut.
 * Quand un produit a "gros activé" mais pas de prix gros override, son
 * prix gros effectif = unit_price - default_gros_rebate_xof.
 *
 * Modifier cette valeur affecte instantanément tous les produits en mode
 * "gros sans override". Les produits avec override (unit_price_gros saisi
 * explicitement par produit) ne sont pas impactés.
 */
export default function PricingSettingsPage() {
  const auth = useAuth();
  const toast = useToast();
  const [rebate, setRebate] = useState<string>('');
  const [initial, setInitial] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!auth.ready) return;
    api.tenantSettings
      .get(auth)
      .then((s) => {
        setRebate(String(s.default_gros_rebate_xof));
        setInitial(s.default_gros_rebate_xof);
      })
      .catch((e) => toast.error(String(e), { title: 'Chargement' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready]);

  async function handleSave() {
    if (!auth.ready) return;
    const next = Number(rebate);
    if (!Number.isFinite(next) || next < 0) {
      toast.warning('Le rabais doit être un nombre positif.');
      return;
    }
    if (initial !== null && next === initial) {
      toast.info('Aucune modification.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.tenantSettings.update(auth, {
        default_gros_rebate_xof: next,
      });
      setInitial(res.default_gros_rebate_xof);
      toast.success(
        `Rabais gros par défaut : ${res.default_gros_rebate_xof.toLocaleString('fr-FR')} XOF`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { title: 'Enregistrement' });
    } finally {
      setBusy(false);
    }
  }

  if (!auth.ready) return <div className="text-sm text-gray-500">Chargement…</div>;

  const num = Number(rebate);
  const example = Number.isFinite(num) && num > 0
    ? `Exemple : pour un produit à 3 500 XOF/kg en détails, le prix gros sera de ${(3500 - num).toLocaleString('fr-FR')} XOF/kg (sauf si un override est saisi sur le produit).`
    : null;

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-2xl font-semibold">Tarification</h2>
        <p className="text-sm text-gray-500">
          Paramètres tarifaires appliqués à tous les produits du tenant.
        </p>
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-4 space-y-4">
        <div>
          <h3 className="text-base font-medium">Rabais "vente en gros" par défaut</h3>
          <p className="mt-1 text-sm text-gray-600">
            Montant en XOF déduit du prix détails pour obtenir le prix gros par défaut.
            Cette règle s'applique automatiquement à tous les produits avec
            l'option <b>vente en gros activée</b> qui n'ont pas de prix gros override saisi
            individuellement.
          </p>
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-xs">
            <label className="block text-xs font-medium text-gray-600">
              Rabais (XOF)
            </label>
            <Input
              type="number"
              min="0"
              step="1"
              value={rebate}
              onChange={(e) => setRebate(e.target.value)}
              className="mt-1 tabular-nums"
              placeholder="Ex: 200"
            />
          </div>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>

        {example && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            {example}
          </div>
        )}

        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
          <div className="font-medium text-gray-700">Comment ça marche</div>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>
              Sur la page <b>Produits</b>, chaque produit a une case "Vente en gros activée".
              Si cochée, la caisse affiche un toggle <i>détails / gros</i> sur la ligne du panier.
            </li>
            <li>
              Par défaut, le prix gros = prix détails − ce rabais.
              Si vous souhaitez un prix gros différent pour un produit précis, saisissez-le
              dans la colonne <b>Prix gros (override)</b> du tableau Produits.
            </li>
            <li>
              Modifier ce rabais affecte instantanément <b>tous les produits sans override</b>.
              Pas besoin de re-saisir chaque produit.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
