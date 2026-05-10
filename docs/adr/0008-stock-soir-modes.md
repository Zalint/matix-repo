# ADR-0008 — Stock soir : deux modes par produit (manuel / automatique) + cron carry-over

- **Statut** : Proposed
- **Date** : 2026-05-10
- **Concerne** : `operations.inventory.movements` + `commercial.sales.reconciliation`
- **Migration associée** : `0014_stock_daily_closings.sql`

## Contexte

Avant la réconciliation comptable de fin de journée, on a besoin d'un "stock soir" propre par (date, point de vente, produit). L'audit Mata a mis en évidence deux modes de saisie qui co-existent dans la vraie vie :

1. **Boucherie / découpe viande** : le poids final ne se déduit pas d'un calcul, il faut **peser physiquement** chaque carcasse en fin de journée. Le stock soir est donc **saisi à la main**. Le calcul théorique (`stock matin − ventes + transferts`) est utile uniquement comme repère pour comparer.

2. **Tous les autres produits** (épicerie, packaging, etc.) : le stock soir se **déduit** des mouvements de la journée. La saisie manuelle reste possible (correction inventaire), mais par défaut le système calcule.

Mélanger les deux comportements dans une même UI sans flag explicite produit deux problèmes : (a) on écrase la saisie manuelle d'un boucher quand un cron recalcule, (b) on force l'utilisateur d'épicerie à saisir une valeur qu'il a déjà.

## Décision

### A. Flag `stock_mode` au niveau produit

Ajout colonne `products.stock_mode TEXT NOT NULL DEFAULT 'automatique' CHECK (stock_mode IN ('manuel','automatique'))`.

Backfill initial : produits dont la catégorie a `family = 'Boucherie'` → `'manuel'`. Tous les autres restent `'automatique'`.

Le flag est **modifiable produit par produit** via `PATCH /products/:id/stock-mode`. UI : badge cliquable dans la grille `/operations/inventory/daily`.

### B. Table `stock_daily_closings`

```
stock_daily_closings (
  tenant_id, closing_date, point_of_sale_id, product_id,
  quantity,             -- valeur effective (saisie ou calculée)
  quantity_theorique,   -- valeur calculée à partir des mouvements (toujours stockée)
  source TEXT CHECK (source IN ('auto','manual')),
  last_auto_at,         -- timestamp du dernier recompute auto
  set_by, set_at,
  UNIQUE (tenant_id, closing_date, point_of_sale_id, product_id)
)
```

RLS forcée (`tenant_id = current_setting('app.tenant_id')`). UNIQUE inclut `tenant_id` (invariant Matix).

Pourquoi stocker `quantity_theorique` à côté de `quantity` ? Parce qu'on veut afficher l'écart même quand l'utilisateur a saisi une valeur manuelle. Le théorique est figé au moment du save — sinon il bougerait silencieusement à chaque nouveau mouvement et l'écart historique perdrait son sens.

### C. Sémantique des deux modes

| | mode `manuel` | mode `automatique` |
|---|---|---|
| Au chargement d'une nouvelle journée | Pas d'entrée → input vide, surligné amber | Pas d'entrée → input pré-rempli avec le théorique (mais pas encore persisté) |
| `recomputeAuto()` | Skip ce produit | Upsert `source='auto'`, `quantity = max(theorique, 0)` |
| Saisie utilisateur | Normal — `setManual()` force `source='manual'` | Idem, écrase l'auto précédent |
| Une fois `source='manual'` | Reste manual jusqu'à override explicite | `recomputeAuto()` ne touche **pas** `quantity` (priorité utilisateur) — mais met à jour `last_auto_at` et `quantity_theorique` |

L'invariant clé : **une saisie utilisateur n'est jamais écrasée par un recalcul automatique**. Le seul moyen de revenir à `auto` est une action explicite (à venir : bouton "réinitialiser auto" si utile).

### D. Cron carry-over (00:30 Africa/Dakar)

Pour chaque ligne `stock_daily_closings` du jour J avec `quantity > 0`, on insère un `stock_movements` `type='opening'` à J+1 avec :
- `quantity = closing.quantity`
- `reference_table = 'stock_daily_closings'`
- `reference_id = closing.id`

Cela rend le carry-over **idempotent** : si on relance le cron, le `WHERE` sur `(reference_table, reference_id)` détecte que l'opening existe et skip.

Implémentation NestJS : `StockCarryOverScheduler` avec `setInterval(60s)` qui compare l'heure courante à `STOCK_CARRY_OVER_HHMM` (default `00:30`) en `Africa/Dakar`. Pas de cron expression pour rester aligné sur le pattern existant `WorkflowsScheduler`. Activation via `STOCK_CARRY_OVER_ENABLED=1`.

Le scheduler utilise `ADMIN_PG_POOL` (BYPASSRLS) car il scanne tous les tenants, mais chaque INSERT passe explicitement le `tenant_id` lu depuis le closing. C'est cohérent avec la charte ADR-0001 : le pool admin n'est utilisé QUE pour des jobs cross-tenant et le tenant_id reste la source de vérité.

### E. Notes de réconciliation

Ajout table `reconciliation_notes (tenant_id, note_date, point_of_sale_id, body)` avec UNIQUE `(tenant_id, note_date, point_of_sale_id)`. Une note libre par (jour, PV) — utilisée pour expliquer les écarts ("coupure de courant 14h-16h", "casse 1 carton"). Pas d'historique des révisions à ce stade — on écrase. Si besoin d'audit, on basculera vers une table append-only `reconciliation_note_revisions`.

Module licensing : `commercial.sales.reconciliation` (passé de `coming-soon` à `active`).

## Conséquences

**Positives**
- Boucher saisit son stock soir comme avant, sans surprise. Épicerie laisse tout au système, sauf correction inventaire.
- L'écart est calculable et historisé pour chaque ligne (pas juste un total agrégé).
- Le carry-over évite la double saisie matin/soir, un point de friction connu sur Maas App.

**À surveiller**
- La page `/operations/inventory/daily` charge un CROSS JOIN products × points_of_sale. Postgres encaisse, mais le rendu DOM côté React est le vrai goulot à grande échelle. Mitigation déjà en place : virtualisation via `@tanstack/react-virtual` (seules ~30 lignes rendues à un instant donné, scroll fluide jusqu'à 100k lignes). Si on atteint des limites au-delà, on ajoutera un filtre catégorie + "non-saisis seulement".
- Si un PV est désactivé en cours de journée, ses lignes restent dans `stock_daily_closings` mais n'apparaissent plus dans la vue (filtre `is_active`). C'est volontaire mais à documenter dans le runbook.
- Le cron tourne en mémoire (`setInterval`). Pour la haute dispo on devra basculer vers BullMQ ou pg-boss quand on aura plusieurs instances API. Pour l'instant single-instance c'est OK.

**Pas implémenté volontairement**
- Pas de validation/lock de la journée ("clôturer pour empêcher modification"). Sera ADR ultérieure si besoin.
- Pas de notification push aux managers en cas d'écart > N% — sera un workflow n8n quand demandé.
- Pas de seuil d'écart "alarme rouge" automatique — la page réconciliation colore en rouge >5%, c'est tout.

## Références
- `apps/api/src/modules/inventory/daily-closing.service.ts`
- `apps/api/src/modules/inventory/stock-carry-over.scheduler.ts`
- `apps/web/src/app/(app)/operations/inventory/daily/page.tsx`
- `apps/web/src/app/(app)/operations/reconciliation/page.tsx`
