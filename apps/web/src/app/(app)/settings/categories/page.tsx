'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageSpinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { api, type ProductCategory } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/**
 * /settings/categories — Gestion des familles & catégories produit.
 *
 * Modèle :
 *   - Catégorie : table product_categories (code unique, name affiché, family).
 *   - Famille : juste un libellé TEXT sur category.family. Pas de table dédiée.
 *     → Créer une nouvelle famille revient à saisir un nouveau libellé au
 *       moment de créer ou éditer une catégorie.
 *
 * UI :
 *   - Liste groupée par famille
 *   - Input famille avec datalist HTML (suggère les familles existantes mais
 *     accepte les nouvelles valeurs librement)
 *   - Édition inline du nom + famille via onBlur
 *   - Soft-delete via bouton "Suppr." (le backend met deleted_at = NOW())
 */
export default function CategoriesSettingsPage() {
  const auth = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<ProductCategory[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [familyDrafts, setFamilyDrafts] = useState<Record<string, string>>({});

  const reload = () => {
    if (!auth.ready) return;
    api.productCategories
      .list(auth)
      .then((rows) => {
        setItems(rows);
        const nd: Record<string, string> = {};
        const fd: Record<string, string> = {};
        for (const c of rows) {
          nd[c.id] = c.name;
          fd[c.id] = c.family ?? '';
        }
        setNameDrafts(nd);
        setFamilyDrafts(fd);
      })
      .catch((e) => toast.error(e.message ?? String(e), { title: 'Chargement' }));
  };

  useEffect(reload, [auth]);

  // Familles distinctes (suggestions pour le datalist)
  const families = useMemo(() => {
    const set = new Set<string>();
    for (const c of items) if (c.family) set.add(c.family);
    return Array.from(set).sort();
  }, [items]);

  // Groupement par famille pour l'affichage
  const grouped = useMemo(() => {
    const map = new Map<string, ProductCategory[]>();
    for (const c of items) {
      const f = c.family ?? '— Sans famille —';
      const list = map.get(f) ?? [];
      list.push(c);
      map.set(f, list);
    }
    return Array.from(map.entries())
      .map(([family, list]) => ({
        family,
        items: list.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.family.localeCompare(b.family));
  }, [items]);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!auth.ready) return;
    setBusy(true);
    const f = e.currentTarget;
    const fd = new FormData(f);
    const familyRaw = String(fd.get('family') ?? '').trim();
    try {
      await api.productCategories.create(auth, {
        code: String(fd.get('code')).trim(),
        name: String(fd.get('name')).trim(),
        ...(familyRaw !== '' ? { family: familyRaw } : {}),
      });
      f.reset();
      setShowForm(false);
      toast.success('Catégorie créée.');
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Création' });
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveName(c: ProductCategory) {
    if (!auth.ready) return;
    const next = (nameDrafts[c.id] ?? '').trim();
    if (next === '' || next === c.name) return;
    try {
      await api.productCategories.update(auth, c.id, { name: next });
      toast.success(`Renommée : ${c.name} → ${next}`, { durationMs: 2000 });
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Renommage' });
    }
  }

  async function handleSaveFamily(c: ProductCategory) {
    if (!auth.ready) return;
    const raw = (familyDrafts[c.id] ?? '').trim();
    const next = raw === '' ? null : raw;
    if (next === c.family) return;
    try {
      await api.productCategories.update(auth, c.id, { family: next });
      toast.success(
        next === null
          ? `${c.name} : sans famille`
          : `${c.name} déplacée vers "${next}"`,
        { durationMs: 2000 },
      );
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Déplacement' });
    }
  }

  async function handleDelete(c: ProductCategory) {
    if (!auth.ready) return;
    const ok = await toast.confirm({
      title: `Supprimer la catégorie "${c.name}" ?`,
      message:
        'Les produits déjà liés à cette catégorie restent en base mais perdent leur catégorie. Tu peux les ré-attribuer après depuis la page Produits.',
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.productCategories.remove(auth, c.id);
      toast.success('Catégorie supprimée.');
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Suppression' });
    }
  }

  if (!auth.ready) return <PageSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Familles & catégories</h2>
          <p className="text-sm text-gray-500">
            Une <b>catégorie</b> regroupe des produits (Bovin, Volaille, etc.). Une{' '}
            <b>famille</b> regroupe des catégories (Boucherie englobe Bovin + Ovin + Caprin + Volaille).
            Modifier la famille d'une catégorie déplace toute la catégorie.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Annuler' : '+ Nouvelle catégorie'}
        </Button>
      </div>

      {/* Datalist des familles partagée par tous les input.family */}
      <datalist id="families-suggestions">
        {families.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      {showForm && (
        <form onSubmit={handleCreate} className="space-y-3 rounded-md border bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input name="code" placeholder="Code (ex: agrume)" required />
            <Input name="name" placeholder="Nom (ex: Agrumes)" required />
            <Input
              name="family"
              placeholder="Famille (ex: Boucherie, Épicerie…)"
              list="families-suggestions"
              title="Saisis une famille existante ou tape un nouveau libellé pour la créer"
            />
          </div>
          <div className="text-xs text-gray-500">
            La famille peut être un libellé existant (le datalist te suggère) ou un nouveau libellé
            que tu tapes — pas besoin de table dédiée pour créer une famille.
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Créer la catégorie'}
          </Button>
        </form>
      )}

      <div className="space-y-4">
        {grouped.length === 0 && (
          <div className="rounded-md border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
            Aucune catégorie pour ce tenant.
          </div>
        )}
        {grouped.map(({ family, items: cats }) => (
          <div key={family} className="rounded-md border border-gray-200 bg-white">
            <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
              Famille : <span className="text-gray-900 normal-case font-medium">{family}</span>
              <span className="ml-2 text-gray-400">({cats.length} catégorie{cats.length > 1 ? 's' : ''})</span>
            </div>
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50/40">
                <tr>
                  <Th>Code</Th>
                  <Th>Nom</Th>
                  <Th>Famille (déplacer)</Th>
                  <Th className="text-right w-20">Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {cats.map((c) => (
                  <tr key={c.id}>
                    <Td className="font-mono text-xs text-gray-500">{c.code}</Td>
                    <Td>
                      <input
                        type="text"
                        value={nameDrafts[c.id] ?? c.name}
                        onChange={(e) =>
                          setNameDrafts((d) => ({ ...d, [c.id]: e.target.value }))
                        }
                        onBlur={() => handleSaveName(c)}
                        className="h-8 w-full rounded border border-transparent bg-transparent px-2 text-sm hover:border-gray-300 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </Td>
                    <Td>
                      <input
                        type="text"
                        value={familyDrafts[c.id] ?? ''}
                        onChange={(e) =>
                          setFamilyDrafts((d) => ({ ...d, [c.id]: e.target.value }))
                        }
                        onBlur={() => handleSaveFamily(c)}
                        list="families-suggestions"
                        placeholder="— sans famille —"
                        className="h-8 w-full rounded border border-transparent bg-transparent px-2 text-sm hover:border-gray-300 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </Td>
                    <Td className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(c)}>
                        Suppr.
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2 text-left font-medium text-gray-600 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2 ${className}`}>{children}</td>;
}
