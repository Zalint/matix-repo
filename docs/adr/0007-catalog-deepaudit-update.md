# ADR-0007 — Mise à jour du catalogue après audit approfondi des 3 codebases

- **Statut** : Proposed
- **Date** : 2026-05-08
- **Référence** : audit profond Maas App / MLC / Dépenses Management

## Contexte

Le catalogue d'origine (ADR-0005) a été construit à partir des audits initiaux à 400 mots des 3 codebases. Un audit approfondi a révélé **5 modules manquants** + une dizaine de nuances métier à documenter pour fidélité au comportement existant Mata.

## Décisions

### A. 5 modules à ajouter

| Code | Pillar | Source | Justification |
|---|---|---|---|
| `commercial.sales.performance_audit` | commercial | Maas — `performance_achat` table | Audit acheteurs : compare estimations vs poids réel ; pénalité 2× surestimation ; verrouillage 24h ; cohérence vs Suivi Achat. **Critique pour le métier viande** où la fraude par surestimation des poids est une vraie perte. |
| `operations.delivery.proof_of_delivery` | operations | MLC — gap identifié | Signature client + photo geo-taggée + timestamp. Hygiène standard B2B delivery, absent de MLC actuel. |
| `operations.delivery.bidirectional_ratings` | operations | MLC — gap identifié | Livreur évalue client (risque, comportement, problèmes paiement). Réciproque des ratings clients existants (service/quality/price). |
| `operations.inventory.unit_conversion` | operations | Maas — `WeightParams` table | Conversion unité→kg HISTORISÉE par date. Si poids standard bœuf change le 10/01, les estimations du 09/01 gardent l'ancien paramètre. **Indispensable pour secteurs viande/agro.** |
| `analytics.market_intelligence` | analytics | Maas — `Veille Bétail` | RSS news Mali/Mauritanie + OpenAI GPT pour alertes (fermetures frontière, sécheresse, prix régionaux, risques approvisionnement). **Niche mais haut différenciateur** pour Mata sur le marché Africain de l'Ouest. |

### B. Précisions à ajouter dans `description_fr` (modules existants)

| Module | Précision à ajouter |
|---|---|
| `commercial.sales.cash_closure` | Fond de caisse + signature commercial à la clôture |
| `commercial.sales.reconciliation` | Formule "Pération" spéciale pour PV abattage : `(Ventes Théoriques / Stock Matin) × 100`. Si Stock Matin = 0, retourner N/A. |
| `commercial.subscriptions.plans` | Cartes numérotées format `MLC-YYYY-NNNN` ; 10 livraisons par défaut ; expiry 6 mois |
| `commercial.crm.customers` | ID format `M_YYMMDD_N` (Mata legacy) ; champs GPS lat/lng ; statut fidélité ; sentiment analysis IA |
| `commercial.crm.credits` | Crédits MATA avec expiration + transactions (CREDIT/DEBIT) + balance tracking |
| `operations.delivery.scoring` | Formule : `score = (bénéfice × 0.0003) + (km × KM_WEIGHT) + (pointages × 0.5)`. Cumul quotidien. |
| `operations.delivery.gps` | 5 zones nommées par défaut (Pikine, Guédiawaye, Mbao, Dakar-Centre, Rufisque) ; rayon 100m configurable ; métriques quotidiennes auto (distance, temps, vitesse, fuel/route efficiency) |
| `operations.hr.expenses` | Catégories : carburant, réparations, police, autres + km_parcourus. UNIQUE(livreur, date). Pattern createOrUpdate. |
| `operations.hr.timesheets` | Photo obligatoire start+end ; modification limitée 15 min côté livreur ; UNIQUE(user, scooter, date) |
| `operations.inventory.livestock` | Décote par défaut 20% (configurable) ; UNIQUE(date, catégorie, produit) — pas de doublons |
| `finance.banking.accounts` | **4 types** : `classique` (solde = crédité − dépensé), `partenaire` (solde décrémenté par livraisons validées), `statut` (lecture-seule, exclu transferts), `ajustement/special` (isolé du P&L) |
| `finance.partners.deliveries` | Workflow : `pending → validée (DG only) → progress %`. Max 2 directeurs assignés. Déduction auto solde. |
| `finance.receivables.portfolio` | Solde = crédit_initial + avances − remboursements. Permissions granulaires : DG seul crédite, directeurs assignés peuvent avancer. |
| `platform.snapshots` | Champs JSON exacts : metadata + dashboard + dépenses + créances + partenaires + stock écarts. UNIQUE(snapshot_date) — 1 snapshot par jour. |
| `finance.accounting.tax` | Sénégal : NINEA, RC, TVA 18%/0%/exonéré, déclarations DGI, format export ITS/DADS-U |

### C. Mise à jour du modèle plans (Phase 1)

| Plan | Modules ajoutés (delta) |
|---|---|
| **Free** | (inchangé) |
| **Starter** | `+commercial.sales.cash_closure`, `+operations.inventory.unit_conversion` (utile dès le POS viande) |
| **Pro** | `+commercial.sales.performance_audit`, `+operations.delivery.proof_of_delivery`, `+operations.delivery.bidirectional_ratings`, `+analytics.market_intelligence` |
| **Enterprise** | (inchangé — déjà tout le catalogue) |

### D. Doc parallèle des pépites métier

Création d'un fichier `docs/business-rules-catalog.md` qui documente — pour chaque module avec une logique métier non-triviale — les **formules exactes**, les **workflows**, les **invariants** à reproduire dans le service Matix correspondant. Source de vérité métier consultable par les devs en code.

Liste initiale des entrées :
- **commercial.sales.reconciliation** : formules ventes théoriques par PV (incluant Pération abattage)
- **commercial.sales.performance_audit** : pénalité 2× surestimation, cohérence ±0.5kg
- **commercial.subscriptions.plans** : workflow card numbering + decrement
- **operations.delivery.scoring** : formule exacte poids
- **operations.inventory.unit_conversion** : algorithme historisation WeightParams
- **finance.banking.accounts** : règles de calcul solde par type
- **finance.partners.deliveries** : workflow validation + déduction
- **finance.receivables.portfolio** : règles permissions opérations
- **platform.snapshots** : structure JSON complète

### E. Modèle comptable — confirmation

Le passage SYSCOHADA double-entry confirmé indispensable Phase 3. Mapping unique-entry → double-entry :
- Dépense classique → Débit classe 6 / Crédit classe 5
- Crédit compte → Débit classe 4 / Crédit classe 4
- Transfert inter-comptes → classe 58
- Stock → classe 3 (31 marchandises, 36 animaux)

Phase 3 ADR dédiée : `0009-syscohada-migration.md` (à venir).

## Conséquences

**Positives**
- Le catalogue couvre maintenant tous les modules métier identifiés dans les 3 apps
- Les 5 nouveaux modules sont des différenciateurs forts (viande/livraison/Africa)
- `business-rules-catalog.md` évite que les devs réinventent ou simplifient à tort

**Négatives**
- Le catalogue grandit à 50 modules — tester que la sidebar UI tient le choc
- Les plans Starter/Pro doivent être recalibrés ; impact sur la grille tarifaire à valider commercialement

## Action items

1. ✅ Étendre `apps/api/src/modules/licensing/catalog.ts` avec les 5 nouveaux modules
2. ✅ Mettre à jour les `description_fr` selon §B
3. ✅ Étendre la migration `0008_licensing.sql` (re-seed plans Starter/Pro avec les nouveaux modules)
4. ✅ Créer `docs/business-rules-catalog.md` avec un placeholder par pépite
5. ⏳ Phase 3 : ADR SYSCOHADA détaillée
