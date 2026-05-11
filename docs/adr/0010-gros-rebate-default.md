# ADR-0010 — Rabais "vente en gros" par défaut au niveau tenant

- **Statut** : Proposed
- **Date** : 2026-05-12
- **Concerne** : `products`, `commercial.sales.pos`, settings tenant
- **Migration associée** : `0016_gros_rebate_setting.sql`
- **Successeur de** : ADR-0009 sur le point "tarif gros par produit"

## Contexte

L'ADR-0009 a introduit `products.unit_price_gros NUMERIC NULL` : un prix de vente en gros optionnel, saisi produit par produit. À l'usage chez Mata, la réalité métier est différente : **le rabais est uniforme sur tous les produits du tenant**. Le directeur fixe "gros = détails − 200 XOF" partout. Saisir un prix gros explicite sur chaque produit est :

- Verbeux à la création.
- Difficile à maintenir (si le rabais change, il faut éditer N produits).
- Erreur-prone (oubli sur un produit → tarif gros incohérent).

Le besoin réel : **un setting global tenant** qui définit le rabais par défaut, **plus la possibilité de surcharger** ponctuellement sur les produits qui en ont besoin.

## Décision

### A. Setting tenant : `default_gros_rebate_xof`

```sql
ALTER TABLE tenants ADD COLUMN default_gros_rebate_xof NUMERIC(14,2)
  NOT NULL DEFAULT 0 CHECK (default_gros_rebate_xof >= 0);
GRANT UPDATE (default_gros_rebate_xof, updated_at) ON tenants TO matix_app;
```

La table `tenants` est système (pas de RLS — accessible via admin pool seulement). Le `GRANT UPDATE` ciblé sur cette colonne permet au compte applicatif de la modifier sans donner accès au reste (legal_name, status, etc.).

### B. Flag produit : `gros_enabled BOOLEAN`

```sql
ALTER TABLE products ADD COLUMN gros_enabled BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE products SET gros_enabled = TRUE WHERE unit_price_gros IS NOT NULL;  -- backfill
```

Le flag découple l'**activation** de la vente en gros de la **valeur** du prix gros. Un produit `gros_enabled=true` avec `unit_price_gros=NULL` utilise le rabais par défaut. Avant, l'activation était implicite via `unit_price_gros IS NOT NULL` — ce qui forçait à saisir une valeur explicite. La nouvelle approche est plus orthogonale.

### C. Calcul du prix gros effectif

```sql
effective_gros_price =
  CASE
    WHEN gros_enabled = FALSE THEN NULL
    WHEN unit_price_gros IS NOT NULL THEN unit_price_gros          -- override
    ELSE GREATEST(unit_price - default_gros_rebate_xof, 0)         -- rabais auto, jamais négatif
  END
```

Cette expression est utilisée à deux endroits :

1. **`ProductsService`** : exposée comme colonne calculée dans tous les SELECT (list/getById/create/update). Le frontend reçoit `effective_gros_price: string | null` qu'il peut afficher directement.

2. **`SalesService.fetchProductPrices`** : utilisée au moment de la vente pour appliquer le bon prix quand `pricing_variant='gros'`. Si `gros_enabled=false`, 400 BadRequest.

### D. Pattern d'écriture : CTE pour INSERT/UPDATE

`RETURNING` natif ne supporte pas les JOIN. Pour conserver le calcul `effective_gros_price` après une mutation, on enveloppe l'INSERT/UPDATE dans une CTE et on SELECT depuis cette CTE avec le JOIN :

```sql
WITH updated AS (
  UPDATE products SET ... WHERE id = $1 RETURNING *
)
SELECT p.id, ..., {EFFECTIVE_GROS_EXPR} AS effective_gros_price
FROM updated p LEFT JOIN tenants t ON t.id = p.tenant_id
```

Trois opérations utilisent ce pattern : `create`, `update`, `setStockMode`.

### E. UI

**Nouvelle page `/settings/pricing`** : un input "Rabais (XOF)" + bouton Enregistrer. L'utilisateur saisit son rabais, voit immédiatement un exemple calculé en dessous.

**Page `/products` refondue** :
- Toggle "Vente gros" par produit (colonne) → switch `gros_enabled`
- Colonne "Prix gros effectif" : affiche le prix calculé + badge "override" ou "auto (−200)"
- Colonne "Override" : input inline-éditable, vide = utiliser le rabais par défaut
- Bandeau bleu en haut rappelant le rabais courant + lien vers `/settings/pricing`

Le formulaire de création gagne une case à cocher "Vente en gros activée" + le champ override (optionnel).

**POS Cart** : aucun changement de comportement utilisateur. La logique snapshot maintenant `effective_gros_price` au lieu de `unit_price_gros` brut.

## Conséquences

**Positives**

- Configurer la "vente en gros" sur un tenant prend 2 actions : (1) saisir le rabais une fois dans `/settings/pricing`, (2) cocher la case sur chaque produit concerné. Plus besoin de saisir un prix gros explicite par produit.
- Changer le rabais global impacte instantanément tous les produits sans override, sans script de migration ni édition manuelle.
- L'override par produit reste possible pour les exceptions (un produit avec une marge gros particulière).
- Le snapshot dans le panier reste cohérent : on stocke le prix appliqué au moment de l'ajout, donc une mutation ultérieure du rabais n'affecte pas un panier déjà ouvert.

**À surveiller**

- Le calcul `effective_gros_price` dépend d'un JOIN. Sur des listes très longues (>10k produits), c'est négligeable car le JOIN est sur la PK `tenants.id`. Pas un sujet pour Mata Phase 1.
- Si on supprime une colonne `unit_price_gros` un jour (cleanup), il faudra migrer les overrides existants vers un mécanisme alternatif. Pour l'instant on garde la colonne — l'override est utile.
- Le flag `gros_enabled` doit être maintenu : si l'utilisateur supprime un override (`unit_price_gros = NULL`), il faut vérifier que `gros_enabled` reste cohérent. La sémantique est claire (les deux sont indépendants), donc pas de bug par défaut.

**Pas implémenté volontairement**

- Pas de rabais par catégorie de produit (boucherie / volaille / etc.). Si demandé, on ajoutera une table `pricing_rules` avec une priorité catégorie > tenant. Phase 2.
- Pas de rabais en pourcentage (le user a explicitement demandé en XOF absolu). Si besoin, on étendra le setting avec un mode `('xof', 'pct')` + valeur.
- Pas d'historique des modifications du rabais. Si audit nécessaire, on ajoutera un trigger qui consigne dans une table d'audit.
- Pas de date d'effet (rabais valable à partir du …). Si besoin, idem : table `pricing_rule_versions`.

## Références

- `db/migrations/0016_gros_rebate_setting.sql`
- `apps/api/src/modules/tenants/tenant-settings.service.ts`
- `apps/api/src/modules/tenants/tenant-settings.controller.ts`
- `apps/api/src/modules/products/products.service.ts` (SELECT_COLS + CTE)
- `apps/api/src/modules/sales/sales.service.ts::fetchProductPrices`
- `apps/api/src/modules/tenants/__tests__/gros-rebate.e2e-spec.ts` (7 cas)
- `apps/web/src/app/(app)/settings/pricing/page.tsx`
- `apps/web/src/app/(app)/products/page.tsx` (refonte)
- `apps/web/src/lib/pos/useCart.ts` (snapshot `effective_gros_price`)
