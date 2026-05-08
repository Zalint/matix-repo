# Business Rules Catalog — Pépites métier des 3 codebases Mata

Source de vérité **métier** (pas technique) pour chaque module Matix qui hérite d'une logique non-triviale issue de Maas App, MLC ou Dépenses Management. À consulter AVANT d'implémenter le service correspondant — pour ne pas réinventer ou simplifier à tort.

Mis à jour à chaque audit. Format : 1 entrée par module, structure {Source, Formule(s), Workflow, Invariants, Cas limites}.

---

## `commercial.sales.reconciliation` — Réconciliation ventes

**Source** : Maas App (`reconciliations`, `stock`, `transferts` tables)

**Formules**
- Ventes théoriques = Stock Matin − Stock Soir + Transferts
- Écart % standard = (Écart / Ventes Théoriques) × 100
- **Pération abattage (point de vente "Abattage" uniquement)** = (Ventes Théoriques / Stock Matin) × 100
  - Si Stock Matin = 0 → retourner N/A (pas de division par 0)
  - Logique : mesure efficacité de transformation/vente brute du stock reçu, pas l'erreur de saisie

**Workflow**
1. Saisie stock matin (J/M ouverture)
2. Saisie ventes du jour
3. Saisie transferts inter-PV
4. Saisie stock soir (clôture)
5. Calcul auto réconciliation → écart par produit/PV
6. Si PV = "Abattage" → utilise Pération au lieu de l'écart standard
7. Inclure dans : UI front, export Excel, API externe

**Invariants**
- Réconciliation ne modifie pas les stocks (lecture seule, audit trail)
- Une réconciliation par (date, point_de_vente, produit)

---

## `commercial.sales.performance_audit` — Audit performance achats

**Source** : Maas App (`performance_achat` table)

**Formules**
- Performance % = (estimation_acheteur − poids_réel) / poids_réel × 100
- Score pénalisé = |performance| × **2 si surestimation**, sinon × 1
  - Pénalise 2× plus la surestimation (risque fraude) que sous-estimation
- Cohérence vs Suivi Achat = SUM(nbr_kg dans Suivi Achat) ± 0.5 kg de tolérance

**Workflow**
1. Acheteur saisit estimation au moment de l'achat
2. Au retour, poids réel est saisi (par admin)
3. Système calcule performance + score pénalisé
4. Vérification cohérence avec Suivi Achat → badge COHÉRENT (vert) ou INCOHÉRENT (rouge)
5. Verrouillage entrée par admin
6. Modification possible par acheteur < 24h après création

**Invariants**
- Verrouillé par admin = non modifiable même < 24h
- Une entrée par (date, acheteur, bête)

---

## `commercial.subscriptions.plans` — Cartes d'abonnement (MLC pattern)

**Source** : MLC (`subscriptions` table)

**Workflow**
- Format card_number : `MLC-YYYY-NNNN` (UNIQUE)
- Defaults : total_deliveries = 10, expiry = +6 mois, price flexible
- Décrémenter `remaining_deliveries` à chaque usage
- Bloquer si `remaining = 0` OR `expiry_date < now()`

**Invariants**
- card_number unique par tenant
- remaining ≥ 0 toujours

---

## `operations.delivery.scoring` — Scoring livreurs

**Source** : MLC (logique dans `orderController.js`)

**Formule exacte**
```
score = (bénéfice_total × PROFIT_WEIGHT)
      + (km_parcourus × KM_WEIGHT)
      + (pointages × POINTAGE_MULTIPLIER)

Constantes par défaut (configurables) :
  PROFIT_WEIGHT      = 0.0003
  KM_WEIGHT          = TBD (à confirmer dans le code MLC)
  POINTAGE_MULTIPLIER = 0.5
```

**Workflow**
- Recalculé en cumul quotidien (cron ou WebSocket)
- Affiché dans dashboard livreur pour auto-évaluation
- Exposé en classement managers

---

## `operations.delivery.gps` — Géofencing & métriques

**Source** : MLC (`gps_locations`, `mlc_zones`, `gps_settings`, `gps_daily_metrics`)

**Configuration par défaut (Sénégal)**
- 5 zones nommées : Pikine, Guédiawaye, Mbao, Dakar-Centre, Rufisque
- Rayon par défaut : 100m (configurable par zone)

**Métriques quotidiennes calculées**
- distance_km (cumul positions)
- time_minutes (durée actif)
- speed_avg / speed_max (km/h)
- fuel_efficiency_score (km / litre carburant)
- route_efficiency_score (% temps en zone)

**Stockage**
- `gps_locations` : positions brutes (lat, lng, accuracy, battery, timestamp)
- `gps_daily_metrics` : upsert par (livreur_id, date)

---

## `operations.hr.expenses` — Dépenses livreur

**Source** : MLC (`expenses` table)

**Catégories obligatoires** (en FCFA)
- carburant, réparations, police, autres
- + `km_parcourus` (aligné avec timesheets)

**Pattern createOrUpdate**
- UNIQUE(livreur_id, expense_date) → un seul enregistrement par livreur/jour
- Sur conflit → UPDATE (permet correction même jour)

---

## `operations.hr.timesheets` — Pointages

**Source** : MLC (`delivery_timesheets`)

**Règles**
- Photo OBLIGATOIRE au start ET au end
- KM start + KM end → calcul total_KM
- scooter_id optionnel (pour parc multi-véhicules)
- UNIQUE(user_id, scooter_id, date)
- Modification limitée à **15 minutes** post-création (livreur)
- Managers : modification illimitée

---

## `operations.inventory.unit_conversion` — Conversion unité ↔ kg

**Source** : Maas App (`weight_params` table)

**Algorithme historisation**
1. Acheteur saisit estimation en unités (ex : "2 bœufs")
2. Système charge `WeightParams` pour la date du jour (ex: bœuf=150kg)
3. Conversion temps réel → stockage en kg (300 kg)
4. Si admin modifie `WeightParams` rétroactivement (ex: bœuf=160kg), les estimations antérieures **gardent** l'ancien paramètre (intégrité historique)

**Schéma minimum**
- `weight_params(date_from, category, unit_weight_kg)` — versionning par date

**Cas d'usage Mata**
- Bœuf adulte ≈ 150 kg
- Veau ≈ 110 kg
- Agneau ≈ 10 kg
- Poulet ≈ 1.5 kg
- Tablette/autres = 1 kg

---

## `operations.inventory.livestock` — Stock vivant

**Source** : Dépenses Management (`stock_vivant` table)

**Modèle**
- Champs : date, catégorie, produit, quantité, prix_unitaire, total
- **Décote** : par défaut 20%, configurable
- **Total** = quantité × prix_unitaire × (1 − decote)

**Contrainte unicité**
- `UNIQUE(date_stock, categorie, produit)` — pas de doublons sur la même clé
- Use case : empêche saisie double même date pour le même produit

---

## `finance.banking.accounts` — Comptes (4 types)

**Source** : Dépenses Management

**4 types et règles de calcul du solde**
| Type | Solde |
|---|---|
| `classique` | total_credité − total_dépensé |
| `partenaire` | total_credité − SUM(livraisons_partenaire validées) |
| `statut` | lecture-seule (override DG uniquement) ; **exclu** des transferts |
| `ajustement/special` | total_credité − total_dépensé ; **isolé** du calcul P&L global |

**Invariant**
- Comptes `special` ne peuvent **jamais** être transférés
- DG seul peut crédit-débit un compte `statut`

---

## `finance.partners.deliveries` — Livraisons partenaires

**Source** : Dépenses Management

**Workflow**
```
[create] → status='pending' → progress 0%
   ↓ [validate by DG]
[validated] → SOLDE -= delivery.amount
   ↓ progress = (livraisons_validées / total_credit) × 100%
ou ↓ [reject by DG]
[rejected] → revert (pas d'impact solde)
```

**Permissions**
- Création : DG ou directeur assigné
- Validation : **DG uniquement**
- Maximum 2 directeurs assignés à un compte partenaire

---

## `finance.receivables.portfolio` — Portfolio créances

**Source** : Dépenses Management

**Formule solde par client**
```
solde_final = crédit_initial 
            + SUM(avances) 
            − SUM(remboursements)
```

**Permissions par opération**
| Type | Qui peut |
|---|---|
| `credit` (crédit initial) | DG uniquement |
| `advance` (avance) | DG ou directeur assigné au compte |
| `debit` (remboursement) | DG ou directeur assigné |

---

## `platform.snapshots` — Snapshots quotidiens JSON

**Source** : Dépenses Management

**Structure JSON**
```json
{
  "metadata": {
    "snapshot_date": "YYYY-MM-DD",
    "created_by_id": <int>,
    "created_at": "<timestamp>",
    "period": "YYYY-MM-01 to YYYY-MM-DD"
  },
  "dashboard": {
    "total_cash": <decimal>,
    "pl": <decimal>,
    "charges_prorata": <decimal>,
    "stock_ecarts": { "mata": ..., "vivant": ... }
  },
  "depenses": [{ "id": <int>, "account": <str>, "total": <decimal>, "date": "..." }],
  "creances": [{ "client": <str>, "solde_final": <decimal>, "operations": [...] }],
  "partenaires": [{ "account": <str>, "livraisons_validees": [...], "progress_pct": <decimal> }]
}
```

**Règles**
- UNIQUE(snapshot_date) — un snapshot par jour
- Re-snapshot même date → ÉCRASE l'existant (pas d'historique multi-versions par jour)
- Lecture-seule après création
- Navigation historique par onglets dates

---

## `analytics.market_intelligence` — Veille marché (Maas pépite)

**Source** : Maas App (`Veille Bétail` feature)

**Sources d'information**
- RSS Google News (queries : "Mali fermeture frontière", "Mauritanie sécheresse", "prix bétail Sénégal", etc.)
- API actualités locales (config-driven)

**Pipeline IA**
1. Collecte RSS (cron toutes les 12h)
2. Déduplication par URL
3. Filtrage thématique (mots-clés métier)
4. Résumé GPT-4o-mini par sujet (cache 12h)
5. Détection alertes : prix anormaux, événements politiques, climat, fermetures frontière

**Output**
- Dashboard "Veille marché" avec cartes par catégorie (climat, politique, prix, logistique)
- Notifications push si alerte critique

---

## Convention pour ajouter une entrée

Quand un module nécessite une logique métier non-triviale issue d'un audit :
1. Ajouter une section dans ce fichier (ordre alphabétique du module code)
2. Renseigner Source, Formule(s), Workflow, Invariants, Cas limites
3. Référencer dans `description_fr` du catalog : "Voir docs/business-rules-catalog.md"
4. À la livraison du module, le PR doit cocher : "logique métier conforme à business-rules-catalog.md"
