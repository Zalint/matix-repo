# Stock soir — guide d'utilisation

Ce guide explique comment fonctionne la saisie du stock soir dans Matix, pour qui c'est, et ce qui se passe la nuit. Il complète l'[ADR-0008](adr/0008-stock-soir-modes.md) qui couvre les décisions techniques.

## En une phrase

Chaque soir, chaque point de vente clôt sa journée avec une valeur de stock par produit. Selon le produit, la valeur est saisie à la main (boucherie) ou calculée par le système (épicerie). Pendant la nuit, le stock soir J devient le stock matin J+1.

## Qui saisit quoi

### Mode `manuel` — par défaut pour la famille Boucherie

Concerne les produits dont la quantité finale ne se déduit pas d'un calcul. Typiquement la viande : on pèse les carcasses en fin de journée, le poids réel ne colle jamais exactement à `stock matin − ventes`.

Le caissier / responsable PV saisit la valeur pesée. Le système affiche à côté la valeur théorique (stock matin − ventes + transferts) comme repère, mais ne l'utilise pas. C'est la saisie qui fait foi.

Si rien n'est saisi le soir, la ligne reste vide et apparaît surlignée en amber dans la grille — c'est un rappel visuel "il manque cette saisie".

### Mode `automatique` — par défaut pour tout le reste

Concerne épicerie, packaging, fournitures, etc. La valeur est déduite des mouvements de la journée : `stock matin + entrées − sorties`.

Le système pré-remplit le champ avec le théorique. Le caissier peut quand même corriger (inventaire, casse non saisie, etc.) — sa saisie écrase l'auto, et la ligne passe en `source='manual'`. À partir de là, le recalcul automatique ne touche plus à cette ligne tant qu'on ne réinitialise pas.

### Comment changer le mode d'un produit

Sur la page **Stock soir (saisie)**, dans la colonne `Mode`, le badge est cliquable. Un clic ouvre une confirmation pour basculer entre `manuel` et `automatique`. Le changement vaut pour tous les PV et toutes les dates futures (les saisies passées restent figées).

API équivalent : `PATCH /products/:id/stock-mode` avec `{ "mode": "manuel" }` ou `{ "mode": "automatique" }`.

## Workflow d'une journée type

| Moment | Qui | Quoi |
|---|---|---|
| 8h | Ouverture PV | Stock matin déjà présent (issu du carry-over de la nuit). Pas d'action manuelle nécessaire. |
| Journée | Caisse + transferts | Chaque vente, retour, transfert insère un `stock_movements`. Le théorique se met à jour automatiquement. |
| 19h-20h | Responsable PV | Ouvre `/operations/inventory/daily`. Pour les produits boucherie, saisit le poids pesé. Pour les autres, vérifie que le théorique colle et clique "Enregistrer modifications" (ou rien à faire si tout va bien — voir plus bas). |
| 20h | Responsable PV | Ouvre `/operations/reconciliation` pour repérer les gros écarts. Ajoute une note du jour si besoin ("coupure de courant 14h-16h"). |
| 00:30 (cron) | Système | Pour chaque ligne `stock_daily_closings` du jour, insère un `stock_movements` `type='opening'` à J+1 avec la quantité saisie. C'est ce qui devient le stock matin du lendemain. |

## La grille de saisie

URL : `/operations/inventory/daily`

Filtres en haut : date + point de vente. Le bouton **Recalculer auto** force un recompute des produits en mode automatique sans toucher aux saisies manuelles. Utile si on a ajusté des mouvements en cours de journée et qu'on veut rafraîchir.

Le tableau a une ligne par produit avec :

- `Stock matin` : stock à l'ouverture (carry-over de la veille)
- `Ventes` : total vendu sur la journée (en rouge)
- `T+ / T-` : net des transferts entrée − sortie
- `Théorique` : ce que le système calcule (`matin − ventes + T+ − T-`)
- `Stock soir` : champ de saisie, pré-rempli si mode auto, vide si mode manuel jamais saisi
- `Source / Écart` : badge `saisie` (orange) ou `auto` (bleu), avec l'écart par rapport au théorique

Le save se fait au `onBlur` (quand on quitte le champ). On peut aussi cliquer **Enregistrer modifications** pour sauver toutes les lignes modifiées d'un coup.

### Les compteurs en haut

Quatre cartes affichent : nombre total de produits, lignes saisies (en mode manual), lignes auto-calculées, lignes manuelles encore en attente. La dernière carte se colore en amber tant qu'il reste des produits boucherie non saisis — c'est le signal "ne pas fermer le PV tout de suite".

### Note du jour

En bas de la page, un champ texte libre. Ce qu'on y écrit ("coupure de courant", "casse 1 carton", "vol suspecté") est associé à la (date, PV) et apparaît sur la page Réconciliation. Pas d'historique des versions — la dernière saisie écrase. Si on a besoin d'audit, on basculera vers une table append-only.

## La page Réconciliation

URL : `/operations/reconciliation`

C'est le tableau de bord post-saisie. Mêmes filtres (date + PV), mais ici on regarde plutôt que de saisir.

Bandeau KPI en haut :

- **Saisis** : nombre de lignes effectivement validées sur le total
- **Manuels en attente** : produits boucherie pas encore saisis (passe à 0 et carte verte quand tout est fait)
- **Écart total (abs)** : somme des |écarts| en unités produit
- **Écart / théorique** : ratio en %. Vert sous 1%, amber entre 1 et 5%, rouge au-delà

Le tableau ne montre **que les lignes avec écart** non nul, triées par |écart| décroissant. Les plus gros problèmes remontent en haut. Pour chaque ligne on voit le théorique, la valeur saisie, l'écart en valeur, le % par rapport au théorique, et la source.

Export CSV en haut à droite — exporte uniquement les lignes avec écart, donc utilisable directement pour une enquête.

## Le cron de nuit

Service : `StockCarryOverScheduler` (NestJS, en mémoire dans le process API).

Stratégie : tick toutes les 60 secondes, compare l'heure courante en `Africa/Dakar` à `STOCK_CARRY_OVER_HHMM`. Quand ça correspond, fire pour la date d'hier. Anti-double-fire par mémorisation du dernier jour traité.

Idempotent : si on relance le carry-over sur le même jour, le check `(reference_table='stock_daily_closings', reference_id=closing.id)` évite les doublons.

### Configuration

Variables d'env (à mettre dans `apps/api/.env`) :

```
STOCK_CARRY_OVER_ENABLED=1
STOCK_CARRY_OVER_HHMM=00:30
STOCK_CARRY_OVER_TZ=Africa/Dakar
```

Sans `STOCK_CARRY_OVER_ENABLED=1` le cron démarre désactivé et trace un warning au boot. C'est volontaire : en dev on ne veut pas qu'il tourne.

### Vérifier qu'il a tourné

Dans les logs API au démarrage :

```
[StockCarryOverScheduler] Cron stock carry-over ACTIF (tick 60s, fire @ 00:30 Africa/Dakar).
```

Puis chaque nuit :

```
[StockCarryOverScheduler] Carry-over tick : closing_date=2026-05-09
[StockCarryOverScheduler] Carry-over OK : 47 openings crees pour 1 tenant(s).
```

Si rien ne sort à 00:30, soit le flag n'est pas activé, soit le process API n'est pas dans le bon fuseau (vérifier l'heure du serveur). Le scheduler utilise `Intl.DateTimeFormat` avec `timeZone: 'Africa/Dakar'` donc l'heure système n'a pas d'importance.

### Lancer un carry-over à la main

Pas d'endpoint exposé pour l'instant — c'est volontaire pour éviter les erreurs. Si besoin de rattrapage, deux options :

1. En SQL via le pool admin (cf. `daily-closing.service.ts::runNightlyCarryOver`), en passant la date à rattraper.
2. Faire `setManual` manuellement sur les lignes du jour J pour forcer la valeur de départ, puis attendre le prochain tick (à 00:30).

Si un cas de rattrapage devient récurrent, on ajoutera un endpoint admin `POST /admin/inventory/daily-closing/run-carry-over { date }`.

## Cas particuliers

### Produit nouvellement créé en cours de journée

Le produit apparaît immédiatement dans la grille du jour. Il aura `stock_matin=0` (pas de carry-over pour ce jour), donc le théorique = `transferts − ventes`. Au save soir, sa valeur devient le stock matin de J+1, et le cycle normal reprend.

### PV désactivé en cours de journée

Si on désactive un PV (`is_active = FALSE`), il disparaît de la grille de saisie et de la réconciliation pour les dates suivantes. Les lignes `stock_daily_closings` déjà saisies restent en base. Le carry-over continuera à tourner sur les lignes existantes même si le PV est inactif — c'est probablement pas ce qu'on veut. À traiter dans un patch si le cas se présente.

### Override d'une saisie manuelle vers auto

Aujourd'hui pas de bouton "réinitialiser auto" sur une ligne devenue `manual`. Pour repasser une ligne en auto :

1. Bascule le produit en mode `automatique` via le badge
2. Clique **Recalculer auto** — la ligne sera réécrite avec le théorique

Cette ergonomie est volontairement limitée pour qu'une saisie manuelle ne soit pas écrasée par accident. À reconsidérer si les utilisateurs demandent un undo plus rapide.

### Plusieurs personnes saisissent en même temps

Le save est par ligne, donc deux personnes peuvent saisir deux produits différents sans conflit. Si deux personnes saisissent le même produit en même temps, c'est le dernier save qui gagne (last-write-wins). Pas de verrou optimiste à ce stade — à voir si on rencontre des problèmes en réel.

## Licensing

Deux modules sont impliqués :

- `operations.inventory.movements` (actions : `read`, `write`, `delete`) — donne accès à la grille de saisie et au recompute auto
- `commercial.sales.reconciliation` (actions : `read`, `write`) — donne accès aux notes et à la page réconciliation

Un tenant qui n'a que le premier voit la grille mais ne peut pas écrire de notes ni voir la page réconciliation. Un tenant qui a les deux a accès complet. Le statut est `active` dans le catalogue depuis cette version.

## Performance

La requête `getDailyView` fait un `CROSS JOIN products × points_of_sale` filtré sur `deleted_at IS NULL` et `pos.is_active`. Au-delà d'environ 2000 produits × 5 PV (= 10 000 lignes), la page va commencer à ramer.

Pistes si on atteint ce volume :

- Filtrer par catégorie de produit côté UI
- Paginer côté backend (offset/limit)
- Indexer (`tenant_id`, `closing_date`, `point_of_sale_id`) si on fait des stats historiques

À surveiller dès le déploiement chez Mata. Le premier client a ~400 produits × 3 PV donc on est large.

## Schéma de données

Trois objets nouveaux :

```
products.stock_mode TEXT NOT NULL DEFAULT 'automatique'
  CHECK (stock_mode IN ('manuel','automatique'))

stock_daily_closings (
  id, tenant_id, closing_date, point_of_sale_id, product_id,
  quantity, quantity_theorique,
  source CHECK (source IN ('auto','manual')),
  last_auto_at, set_by, set_at, created_at, updated_at,
  UNIQUE (tenant_id, closing_date, point_of_sale_id, product_id)
)

reconciliation_notes (
  id, tenant_id, note_date, point_of_sale_id, body,
  set_by, created_at, updated_at,
  UNIQUE (tenant_id, note_date, point_of_sale_id)
)
```

Toutes deux ont `RLS enabled + forced` avec la policy standard `tenant_id = current_setting('app.tenant_id')`. Les UNIQUE incluent `tenant_id` (invariant ADR-0001).

## Endpoints

```
GET    /inventory/daily-closing?date=YYYY-MM-DD&point_of_sale_id=UUID
PUT    /inventory/daily-closing
       body: { closing_date, point_of_sale_id, product_id, quantity }
POST   /inventory/daily-closing/recompute-auto
       body: { closing_date, point_of_sale_id? }

GET    /inventory/daily-closing/notes?date=YYYY-MM-DD&point_of_sale_id=UUID
PUT    /inventory/daily-closing/notes
       body: { note_date, point_of_sale_id, body }

PATCH  /products/:id/stock-mode
       body: { mode: 'manuel' | 'automatique' }
```

Tous gardés par `RequiresModule`. Auth standard (Keycloak ou dev headers selon `AUTH_MODE`).

## Limites connues / pas implémenté

- Pas de validation/lock de journée. N'importe qui avec le droit `write` peut modifier une saisie de la veille. Si on a besoin d'une notion de "clôture définitive", ce sera une ADR séparée.
- Pas de notification push aux managers en cas d'écart > N%. Quand ce sera demandé, on l'expose comme un workflow n8n qui consomme un événement `inventory.daily_closing.set`.
- Pas d'audit trail des révisions de note. La dernière écriture écrase.
- Le scheduler tourne dans le process API (`setInterval`). Pour la haute dispo multi-instance, il faudra basculer vers BullMQ ou pg-boss avec verrou. Pour Mata Phase 1 (single instance) c'est OK.

## Pour aller plus loin

- Décision architecturale : [ADR-0008](adr/0008-stock-soir-modes.md)
- Code service : `apps/api/src/modules/inventory/daily-closing.service.ts`
- Code scheduler : `apps/api/src/modules/inventory/stock-carry-over.scheduler.ts`
- Migration SQL : `db/migrations/0014_stock_daily_closings.sql`
- Tests e2e (5 cas) : `apps/api/src/modules/inventory/__tests__/daily-closing.e2e-spec.ts`
- UI saisie : `apps/web/src/app/(app)/operations/inventory/daily/page.tsx`
- UI réconciliation : `apps/web/src/app/(app)/operations/reconciliation/page.tsx`
