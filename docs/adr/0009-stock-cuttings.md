# ADR-0009 — Découpes : nouvelle primitive de mouvement de stock + tarif gros à la vente

- **Statut** : Proposed
- **Date** : 2026-05-12
- **Concerne** : `operations.inventory.movements`, `commercial.sales.pos`
- **Migration associée** : `0015_stock_cuttings.sql`
- **Supersede** : aucun. Étend la modélisation de l'ADR-0008 (`stock_daily_closings`).

## Contexte

Le métier de boucherie consomme des **matières premières** (carcasses, viande à hacher) pour produire **plusieurs produits finis** avec un rendement <100%. Le legacy Mata gérait ça avec :

- Un mapping JSON statique côté code pour faire correspondre "Boeuf en stock" à "Boeuf détails" + "Boeuf gros" en vente.
- Deux mouvements de transfert indépendants pour matérialiser une transformation (ex. 7 kg viande → 6 kg hachée), sans lien explicite entre eux.
- Aucune trace de la chute (os, gras) — déduite par soustraction implicite quand on calculait la "perte" agrégée.

Trois limites :

1. **Pas de traçabilité** : impossible en SQL de répondre à "combien de kg de boeuf ont été transformés en hachée ce mois-ci ?".
2. **Chute invisible** : confondue avec les pertes par vol/casse/erreur de comptage dans la formule `matin + in - out - soir`.
3. **Mapping figé** : ajouter un produit ou changer une équivalence demande un déploiement, pas d'admin UI.

## Décision

### A. Nouvelle table `stock_cuttings` + lignes `stock_cutting_outputs`

```
stock_cuttings (
  tenant_id, point_of_sale_id, performed_at,
  source_product_id, source_quantity,
  total_outputs, waste_quantity, waste_pct,  -- denormalisés au commit
  performed_by, notes
)

stock_cutting_outputs (
  tenant_id, cutting_id (FK), product_id, quantity, unit_cost,
  UNIQUE (tenant_id, cutting_id, product_id)
)
```

RLS forcée sur les deux tables. Le UNIQUE inclut `tenant_id` (invariant Matix). La chute est **calculée au moment du save** (`source - Σ outputs`) et **stockée en denorm** dans `waste_quantity` et `waste_pct` pour des stats rapides sans recompute.

### B. Deux nouveaux types de `stock_movements`

Le CHECK constraint sur `stock_movements.movement_type` est étendu pour autoriser :

- `cutting_in` : entrée positive sur un produit fini, issue d'une découpe
- `cutting_out` : sortie négative sur la source d'une découpe

Le trigger existant `fn_apply_stock_movement` met à jour `stock_levels.quantity_on_hand` à partir de `quantity` signée — il fonctionne sans modification pour ces nouveaux types.

Chaque mouvement généré par une découpe porte `reference_table='stock_cuttings'` + `reference_id=cutting.id`. C'est ça qui permet le lien entre les 1 + N mouvements d'une même découpe.

### C. Atomicité

`CuttingsService.create()` insère dans une seule transaction HTTP (gérée par `TenantTxInterceptor`) :
- 1 ligne `stock_cuttings`
- N lignes `stock_cutting_outputs`
- 1 mouvement `cutting_out` sur la source
- N mouvements `cutting_in` sur les sorties

Si l'un échoue, tout rollback. Pas de mouvement orphelin possible.

### D. Validations métier dans le service

- `source_quantity > 0`
- Chaque `output.quantity > 0`
- `Σ outputs ≤ source_quantity` (sinon BadRequest — la chute ne peut pas être négative)
- Pas de doublon de `product_id` dans les outputs
- Le `source_product_id` ne peut pas être aussi en output (cas de re-conditionnement à modéliser séparément si besoin)
- Stock de la source suffisant — pas explicitement vérifié dans le service ; le trigger sur `stock_levels` ne bloque pas pour rester cohérent avec le pattern existant (`adjustment` peut aussi rendre le stock négatif). Si besoin, ajouter un check optionnel.

### E. Stat de rendement

`CuttingsService.yieldStats({from, to, posId?})` agrège par `source_product_id` sur une fenêtre, retournant : nombre de découpes, source totale, sorties totales, chute totale, rendement %. Une requête `GROUP BY` qui sort la même info que ce qui était impossible côté legacy.

### F. Tarif gros à la vente (pas à la découpe)

L'audit utilisateurs a confirmé : la distinction "détails / gros" est **commerciale et tardive**, prise au moment de l'encaissement par le caissier. Pas au moment de la découpe. Conséquences :

- **Stock = un seul SKU**. La carcasse découpée donne `Boeuf` (et `Filet`, `Jarret`, etc.), pas `Boeuf détails` et `Boeuf gros`.
- **Tarif par produit** : ajout colonne `products.unit_price_gros NUMERIC NULL` (NULL = pas de tarif gros, pas de toggle POS).
- **Ligne de vente** : ajout colonne `sale_items.pricing_variant TEXT NULL CHECK IN ('detail','gros')` qui trace quel tarif a été appliqué — utile pour les stats CA détails vs gros.

Le POS affichera un segmented control "détails / gros" uniquement pour les produits dont `unit_price_gros IS NOT NULL`.

### G. Intégration `DailyClosingService.getDailyView`

Le calcul du stock théorique soir inclut maintenant les `cutting_in` et `cutting_out` :

```
théorique = stock_matin + transferts_in - transferts_out
         + adjustments + retours
         + cuttings_in - cuttings_out
         - ventes
```

Conséquence pour la page Réconciliation : la chute de découpe **ne pollue plus** l'écart d'inventaire. La carcasse `cutting_out` égale le `cutting_in` des produits finis (en cumul net), donc le théorique des produits finis est augmenté correctement. La chute est exposée séparément via `stock_cuttings.waste_quantity` — c'est ce qui permet la décomposition de la perte présentée dans la scène 5 du mockup utilisateur.

## Conséquences

**Positives**

- Une découpe = une action utilisateur, plus du tout de double saisie (cf. hachée legacy).
- Stat de rendement par boucher, par mois, par produit source — gratuite côté SQL.
- L'écart d'inventaire à la réconciliation ne mélange plus chute et perte non expliquée.
- Le tarif gros est cohérent : pas de SKU séparé, pas de mapping JSON, juste une colonne prix.

**À surveiller**

- Le service ne vérifie pas que le stock de la source est suffisant. Si on découpe 120 kg de carcasse mais qu'on n'en a que 100 en stock, on aura un `quantity_on_hand` négatif. À discuter avec les ops si on veut bloquer ou tolérer (utile en cas de saisie a posteriori où le stock matin n'est pas encore renseigné).
- La table `stock_cutting_outputs` peut grossir vite (5-10 lignes par découpe × N découpes par jour). Les index `(tenant_id, cutting_id)` et `(tenant_id, product_id)` couvrent les requêtes principales. À surveiller au-delà de quelques millions de lignes.
- Le coût de répartition au prorata est basique (uniforme sur poids). Pour les acheteurs qui veulent un coût plus fin par produit fini (le filet vaut plus que le jarret), il faudra une table `cost_allocation_rules` à terme. Pas Phase 1.

**Pas implémenté volontairement**

- Pas de "recettes standards" stockées (table `cutting_recipes`). On les affichera côté UI comme des suggestions hardcodées au début, on les externalisera si les ops veulent les modifier eux-mêmes.
- Pas d'`undo` côté UI (annulation d'une découpe). Pour annuler il faudrait insérer 2 mouvements inverses + supprimer la ligne `stock_cuttings`. À ajouter quand un cas réel se présente.
- Pas de redécoupe automatique (par exemple si on découvre que `Boeuf détails` aurait dû être `Boeuf gros` — mais avec la décision G, ce cas n'existe plus, c'est une simple bascule de tarif à la vente).
- Pas de workflow d'approbation des découpes. Si la fraude par sous-déclaration des sorties devient un sujet, on l'expose via le moteur de workflows existant.

## Références

- `apps/api/src/modules/inventory/cuttings.service.ts`
- `apps/api/src/modules/inventory/cuttings.controller.ts`
- `apps/api/src/modules/inventory/dto/cutting.dto.ts`
- `apps/api/src/modules/inventory/__tests__/cuttings.e2e-spec.ts` (8 cas, RLS + transactionnel + intégration daily-closing)
- `apps/web/src/app/(app)/operations/inventory/cuttings/page.tsx`
- `apps/web/src/app/(app)/operations/inventory/cuttings/_components/new-cutting-drawer.tsx`
- `db/migrations/0015_stock_cuttings.sql`
- Mockup users : `docs/mockups/cuttings-ui.html` (6 scènes interactives)
- Doc users : `docs/mockups/explication-users.md` (à envoyer aux ops Mata pour valider l'UX et 6 questions ouvertes)
