# Couverture fonctionnelle — Matix vs apps Mata existantes

> Audit comparatif : pour chaque fonctionnalité des 3 apps Mata, identifier
> si elle est couverte par un module du catalogue Matix, à porter, ou hors scope.
>
> **Source de vérité Matix** : `apps/api/src/modules/licensing/catalog.ts` (88 modules, 6 piliers — 5 peuplés)
> **Pépites métier déjà capturées** : `docs/business-rules-catalog.md` (référencé `[BR]`)
> **Apps auditées** :
> - **Maas App** — Node/Express + PG/Sequelize, schema-per-tenant, ~16k lignes `server.js` + 9 routers
> - **MLC (Matix Livreur)** — Node/Express + PG/JWT, mono-tenant, 17 routers, modèles `Order/User/Timesheet/GpsLocation/Subscription/...`
> - **Dépenses Management** — Node/Express + PG, mono-tenant, ~17k lignes `server.js`
> - **Workflows n8n externes** (3) — orchestration cross-apps + rapports email (cf. `infra/n8n-workflows/`)
>
> Audit initial : 2026-05-09. Mise à jour : 2026-05-09 — ajout audit n8n, 4 nouveaux modules au catalogue.

## Légende statut

| Symbole | Sens |
|---|---|
| **Livré** | module Matix existe ET implémenté côté API/Web (cf. README "État détaillé") |
| **Catalogué** | module Matix listé `coming-soon` dans `catalog.ts` mais pas encore livré |
| **Beta** | module Matix `beta` (squelette livré, non production-ready) |
| **Gap** | fonctionnalité présente dans une app Mata, AUCUN module Matix correspondant |
| **Hors scope** | volontairement non porté (justification donnée) |

---

## 1. Maas App — Ventes / Stock / Boucherie / Abonnements

### 1.1 Fonctionnalités auditées

| # | Fonctionnalité Maas | Évidence (route/file) | Module Matix | Statut | Notes métier |
|---|---|---|---|---|---|
| 1 | Authentification + sessions + multi-PV par user | `/api/login`, `routes/auth.js`, `user_points_vente` | `platform.identity` | Livré | Maas = sessions cookies ; Matix = Keycloak OIDC |
| 2 | Gestion users admin (CRUD, toggle, default-screen) | `/api/admin/users/*` | `platform.team` | Livré | À porter : champ `default_screen` + restrictions par PV |
| 3 | Configuration centralisée tenant (produits, PV, prix, payment_ref) | `routes/config-admin.js` (50 ko), `routes/modules.js` | `platform.settings` + `commercial.pricing.lists` | Livré (settings) / Catalogué (pricing) | Pépite : `payment_ref` par PV (mapping Bictorys) déjà en BDD Maas |
| 4 | POS / Caisse encaissement (panier, ventes) | `/api/ventes` (POST/GET/PUT/DELETE), `/api/ventes/jour/:date` | `commercial.sales.pos` | Livré | UI Caisse + Standard livré côté Matix |
| 5 | Import ventes Excel/CSV | `/api/import-ventes` | `analytics.exports.csv` (inverse) + `commercial.sales.pos` | Catalogué | Gap mineur : import bulk de ventes legacy |
| 6 | Stock matin / soir / transferts (saisie) | `/api/stock/:type`, `/api/transferts` | `operations.inventory.levels` + `operations.inventory.movements` + `operations.inventory.transfers` | Livré (levels/movements) / Catalogué (transfers) | Stock soir auto-calculé pour produits `mode_stock=automatique` (commit récent Maas) |
| 7 | Réconciliation ventes (formule "Pération" abattage) | `/api/reconciliation/save`, `/api/reconciliation/load`, `/api/external/reconciliation*` | `commercial.sales.reconciliation` | Catalogué | `[BR]` formule unique abattage = `(VT/StockMatin)*100` ; standard = `(Écart/VT)*100` |
| 8 | Copie auto stock soir J → matin J+1 (cron 5h UTC) | `scripts/copy-stock-cron.js`, `STOCK_COPY_AUTOMATION_README.md` | `operations.inventory.movements` | Catalogué | À porter : job nocturne BullMQ + idempotence par date |
| 9 | Achats bœuf (suivi achat) | `/api/achats-boeuf` (CRUD + stats monthly), `models/AchatBoeuf.js` | `operations.procurement.slaughter` | Catalogué | Champ `nbr_kg` cible cohérence ±0.5kg vs Performance Achat |
| 10 | Audit performance achats (estimation vs réel, score x2 surestimation) | `/api/performance-achat`, `/api/external/performance-achat`, `models/PerformanceAchat.js` | `commercial.sales.performance_audit` | Catalogué | `[BR]` score pénalisé x2 surestim, verrou 24h, cohérence ±0.5kg |
| 11 | Estimations produits (boeuf=150kg/unité, etc.) avec WeightParams historisés | `/api/estimations` (CRUD + bulk + recalculate), `/api/weight-params/:date`, `models/WeightParams.js` | `operations.inventory.unit_conversion` | Catalogué | `[BR]` historisation par date — intégrité rétroactive |
| 12 | Pré-commandes (workflow draft → convert → archive) | `/api/precommandes/*` (CRUD + convert + cancel + archive) | `commercial.sales.pos` (étendu) | Gap | Pas de module dédié orders pre-commit. Suggestion : `commercial.sales.preorders` |
| 13 | Abonnements clients (prélèvements mensuels, point de vente défaut) | `routes/abonnements.js`, `models/ClientAbonne.js`, `models/PaiementAbonnement.js` | `commercial.subscriptions.plans` + `commercial.subscriptions.billing` | Catalogué | Maas = abonnement client (vs MLC = carte livraisons). Logique différente : statut mensuel calculé par `mois=YYYY-MM` |
| 14 | Cash payments (Bictorys aggregated import + manual + ref-mapping) | `/api/cash-payments/*`, `/api/payment-ref-mapping`, `/api/external/cash-payment/import` | `finance.payments.mobile_money` (Bictorys) | Catalogué | Pépite : intégration Bictorys MultiOpérateurs déjà fonctionnelle ; mapping V_/A_ par PV |
| 15 | Payment links Bictorys (création, status, archive, weekly) | `routes/payments-generated.js`, `/api/payment-links/*` | `finance.payments.mobile_money` | Catalogué | Sous-feature de Bictorys : génération link individuel avec callback |
| 16 | OCR factures (extraction + upload + history) | `/api/ocr-extract`, `/api/ocr-imports`, `models/OcrImport.js` | `finance.expenses.ocr` | Catalogué | Maas l'utilise pour reconnaître produits depuis tickets ; Matix le placera côté finance |
| 17 | Veille bétail (RSS Mali/Mauritanie + GPT-4o-mini, cache 12h) | `/api/veille-betail`, `VEILLE_BETAIL_DOCUMENTATION.md` | `analytics.market_intelligence` | Catalogué | `[BR]` complète : 5 keywords, 25 articles/run, cache 12h |
| 18 | Audit client (historique commandes/paiements par phone) | `/api/audit-client`, `models/AuditClientLog.js` | `commercial.crm.communications` + `analytics.reports.standard` | Catalogué | Pépite : tracé inter-tenant via phone_number ; Matix prévoir `commercial.crm.customer_audit` |
| 19 | Audit logs (qui a modifié quoi quand) | `routes/auditLogs.js`, table `audit_logs` | `platform.audit` | Catalogué | Maas = trail métier ; Matix doit étendre pour multi-tenant + filtres user/PV |
| 20 | Restrictions temporelles utilisateurs spécifiques (NADOU/PAPI) | middleware `checkTimeRestrictions`, `RESTRICTIONS_TEMPORELLES_README.md` | `platform.settings` (config) + `operations.inventory.movements` (enforcement) | Catalogué | Pattern : J+1 3h00 cutoff. À généraliser comme `edit_lock_after_hours` configurable |
| 21 | Gestion commandes statut + livreurs (intégration MLC) | `/api/commandes/statut`, `/api/livreur/*`, `/api/realtime/commandes-statut` | `operations.delivery.orders` + `operations.delivery.drivers` | Catalogué | À unifier avec MLC (cf. section 2) |
| 22 | Crédit client (use/refund + commande linkage) | `/api/credit/use`, `/api/credit/refund`, `/api/commandes/:id/credit` | `commercial.crm.credits` | Catalogué | Idem MLC ; à harmoniser : version optimistic locking déjà présent côté MLC |
| 23 | Web orders (file → assign → convert → archive) | `/api/weborders/*` | `operations.delivery.orders` | Catalogué | Workflow assign/unassign/convert spécifique e-commerce |
| 24 | Day screening (clôture journée) | `/api/day-screening/start`, `/api/day-screening/status` | `commercial.sales.cash_closure` | Catalogué | À étendre : "screening" Maas = checklist quotidienne avant clôture |
| 25 | Clôtures de caisse (estimatif + final) | `/api/clotures-caisse`, `/api/clotures-caisse/estimatif` | `commercial.sales.cash_closure` | Catalogué | Workflow : estimatif (auto-calc) → final (validation) |
| 26 | Traçabilité viande | `/api/tracabilite-viande` | `operations.procurement.slaughter` (étendu) | Gap | Pas de module trace lot→PV. Suggestion : `operations.procurement.traceability` |
| 27 | Print direct (impression ticket POS) | `/api/print-direct` | `finance.invoicing.tickets` + `finance.invoicing.pdf` | Catalogué | Format ESC/POS direct (pas PDF) ; à reconsidérer côté Matix |
| 28 | Découpe forwarding (centres + range) | `routes/decoupe-forward.js`, `/api/decoupe/*` | `operations.procurement.slaughter` | Gap (sous-feature) | Sous-process abattage : forward de découpes vers centres ; à intégrer dans `slaughter` |
| 29 | Analytics dashboards (marges, ratios abattage par PV) | `/api/external/analytics`, `ANALYTICS_V1_DOCUMENTATION.md` | `analytics.dashboards.sales` + `analytics.dashboards.inventory` | Catalogué | Logique adaptative GLOBAL vs SPÉCIFIQUE PV ; retry -1 jour pour prix moyen |
| 30 | Realtime dashboard (last-updates, packs) | `/api/realtime/last-updates`, `/api/realtime/reconciliation`, `/api/realtime/packs` | `analytics.dashboards.sales` (live) | Gap | Polling/SSE temps réel ; pas couvert par les modules dashboard cataloguus. Suggestion : intégrer en option dashboards |
| 31 | Externe API publique (cles API + endpoints lecture) | `validateApiKey`, `/api/external/*` (~30 endpoints) | `platform.api_keys` + `platform.webhooks` | Catalogué | Pattern API key → endpoints lecture exposés à BI externes |
| 32 | Prix moyen pondéré (sur achats bœuf, période glissante) | `/api/prix-moyen`, `/api/test-prix-moyen` | `commercial.pricing.history` | Catalogué | À porter : moyenne pondérée par kg sur période + retry décalage |
| 33 | Stock soir marge (calcul P&L par produit) | `/api/external/stock-soir-marge` | `analytics.dashboards.finance` + `operations.inventory.valuation` | Catalogué | Combine valorisation + marge brute à date |
| 34 | Module enable/disable par tenant | `routes/modules.js` | `platform.licensing` (interne Matix) | Livré | Matix utilise `tenant_licenses` + catalog ; Maas avait simple flag |

### 1.2 Maas — Fonctionnalités SANS équivalent Matix (gaps)

| Gap | Module Matix suggéré | Justification |
|---|---|---|
| Pré-commandes (workflow draft → convert) | `commercial.sales.preorders` | Use case fréquent boucherie : commande téléphonique avant retrait |
| Traçabilité viande lot → PV | `operations.procurement.traceability` | Conformité sanitaire, suit un bœuf de l'abattage à la vente |
| Découpe (centres + forwarding) | sous-feature de `operations.procurement.slaughter` | Étendre la description du module avec sous-process découpe |
| Realtime updates dashboard (SSE/polling) | option transverse aux `analytics.dashboards.*` | Pas un module à part, mais doit être prévu dans la spec dashboards |
| Configuration verrou temporel (J+1 3h) | option de `platform.settings` (`edit_lock_hours`) | À généraliser : règle aujourd'hui hard-codée pour 2 users |
| Abonnement clients mensuel (vs cartes MLC) | `commercial.subscriptions.plans` (étendre) | Vérifier que le module catalogué couvre bien le pattern Maas (statut mensuel `YYYY-MM`) en plus du pattern MLC (carte de N livraisons) |

---

## 2. MLC (Matix Livreur) — Livraison / GPS / CRM léger

### 2.1 Fonctionnalités auditées

| # | Fonctionnalité MLC | Évidence (route/file) | Module Matix | Statut | Notes métier |
|---|---|---|---|---|---|
| 1 | Auth JWT (login/logout/refresh/change-password) | `routes/auth.js`, `controllers/authController.js` | `platform.identity` | Livré | Matix = Keycloak OIDC ; pattern roles MANAGER/ADMIN/LIVREUR/VIEWER à mapper sur Keycloak |
| 2 | Users CRUD + activation + reset password + roles | `routes/users.js` | `platform.team` | Livré | 4 rôles MLC : ADMIN, MANAGER, LIVREUR, VIEWER |
| 3 | Commandes livraison (CRUD + by-date + dashboard) | `routes/orders.js` (44 routes), `controllers/orderController.js` | `operations.delivery.orders` | Catalogué | Cœur métier MLC : ~30 endpoints sur orders |
| 4 | Tableau MATA mensuel (commentaires éditables) | `OrderController.getMataMonthlyDashboard`, `mata-monthly-export` | `analytics.dashboards.sales` (segmenté MATA) | Catalogué | Pattern : tableau mensuel par client avec edits in-place |
| 5 | Recherche client par nom/téléphone | `OrderController.searchClients`, `getClientByPhone` | `commercial.crm.customers` | Livré | Matix CRM doit indexer phone+nom |
| 6 | Historique commandes par client | `OrderController.getClientOrderHistory` | `commercial.crm.communications` | Catalogué | À enrichir : historique livraisons par client |
| 7 | Rating commandes (rating bidirectionnel client/livreur) | `PUT /:id/rating`, `add_rating_columns.sql`, `add_average_rating.sql` | `operations.delivery.bidirectional_ratings` | Catalogué | `[BR]` : livreur évalue client (risque) ; client note livraison (qualité) |
| 8 | Pointages (photos start/end + KM start/end + scooter optionnel) | `routes/timesheets.js`, `controllers/timesheetController.js` | `operations.hr.timesheets` | Catalogué | `[BR]` : photo OBLIGATOIRE start ET end, modif livreur 15min, UNIQUE(user, scooter, date) |
| 9 | Dépenses livreur (carburant, réparations, police, autres + km) | `routes/expenses.js`, `controllers/expenseController.js` | `operations.hr.expenses` | Catalogué | `[BR]` : pattern createOrUpdate par UNIQUE(livreur,date) |
| 10 | GPS location (POST live + history + offline + cleanup) | `routes/gps.js`, `controllers/gpsController.js`, `models/GpsLocation.js` | `operations.delivery.gps` | Catalogué | Tables : `gps_locations` (raw) + `gps_daily_metrics` (upsert) |
| 11 | Configuration heures GPS par livreur (jour, plage horaire, timezone) | `tracking_start_hour/end_hour/enabled_days/timezone`, `GUIDE_TRACKING_HORAIRE.md` | `operations.delivery.gps` (extension) | Catalogué | Refus position hors plage avec code `TRACKING_HOURS_RESTRICTED` |
| 12 | Zones MLC (5 zones Sénégal : Pikine, Guédiawaye, Mbao, Dakar, Rufisque) | `routes/mlcZones.js`, `mlc_zones` table | `operations.delivery.gps` (zones) | Catalogué | Rayon configurable par zone (default 100m) |
| 13 | Analytics GPS (perf quotidienne, hebdo, ranking, comparison, zone analytics) | `routes/gpsAnalytics.js`, `controllers/gpsAnalyticsController.js` | `analytics.dashboards.custom` + `operations.delivery.gps` | Catalogué | Métriques : `distance_km`, `time_minutes`, `speed_avg/max`, `fuel_efficiency`, `route_efficiency` |
| 14 | Scoring livreur (cumul quotidien) | `routes/ranking.js`, calcul dans `orderController.js` | `operations.delivery.scoring` | Catalogué | `[BR]` : `(bénéfice × 0.0003) + (km × KM_WEIGHT) + (pointages × 0.5)` |
| 15 | Subscriptions / Cartes livraison MLC-YYYY-NNNN | `routes/subscriptions.js`, `models/Subscription.js` | `commercial.subscriptions.plans` | Catalogué | `[BR]` : default 10 livraisons / 6 mois, décrément à chaque usage, blocage si remaining=0 OR expiry<now |
| 16 | Salaires livreurs | `routes/salaries.js` | `operations.hr.expenses` (étendu) | Gap | Pas de module paie/salaires distinct. Suggestion : `operations.hr.payroll` (Phase 3+) |
| 17 | Versements (paiements à la société par livreur) | `routes/versements.js`, `controllers/versementsController.js` | `finance.banking.transfers` (interne) | Gap | Pattern : livreur encaisse cash → reverse à l'entreprise. Suggestion : `operations.delivery.cash_remittance` |
| 18 | Crédits clients MATA (avec tags STANDARD/VIP/VVIP) | `routes/clientCredits.js`, `controllers/clientCreditsController.js`, `add_client_tags.sql` | `commercial.crm.credits` + `commercial.crm.tags` | Catalogué | Optimistic locking via `version` ; tags VIP/VVIP comme typologie client |
| 19 | Commandes en cours (workflow ouvertes, externalisation API) | `routes/commandesEnCours.js`, table `commandes_en_cours` | `operations.delivery.orders` (statut) | Catalogué | Statut intermédiaire entre "créée" et "livrée" ; routes externes API key |
| 20 | Pièces jointes commandes (upload, download, delete) | `routes/attachments.js`, `controllers/attachmentController.js`, table `order_attachments` | `platform.files` | Catalogué | Photos livraison, justificatifs ; Matix prévu via R2 |
| 21 | Preuve de livraison (photo + signature) | dans `attachments` + rating, mais pas de POD formalisé | `operations.delivery.proof_of_delivery` | Catalogué | Pas implémenté formellement dans MLC ; Matix doit ajouter signature + geo-tag |
| 22 | Audit client (analyse approfondie + sentiment IA) | `routes/audit.js`, `controllers/deepAnalysisController.js`, `controllers/externalMataAuditController.js` | `commercial.crm.communications` + `analytics.ai.insights` | Catalogué | Cache 6h sentiment + skip_sentiment fast path |
| 23 | Source de connaissance client + sentiment commentaires | `add_source_connaissance_column.sql`, `controllers/mataAnalyticsController.js` | `commercial.crm.customers` (champ) + `analytics.ai.insights` | Catalogué | Champ `source_connaissance` (Facebook, bouche-à-oreille, etc.) + analyse OpenAI commentaires |
| 24 | Analytics MATA (12 endpoints : LTV, retention, churn, top, frequent, etc.) | `routes/analytics.js` (12 routes) | `analytics.dashboards.custom` + `analytics.reports.standard` | Catalogué | À porter : LTV, churn risk, customer retention, satisfaction, by-day-of-week |
| 25 | Export Excel (commandes, MATA mensuel, livreur details) | `OrderController.exportToExcel`, `exportLivreurDetailsToExcel`, etc. | `analytics.exports.excel` | Catalogué | Patterns d'export : par date range, par livreur, par MATA, par client details |
| 26 | API externe (livreurs actifs, audit client, credits par phone) | `external.js` (1280 lignes), `validateApiKey` | `platform.api_keys` | Catalogué | Idem Maas : API key → endpoints lecture |
| 27 | Tags clients (STANDARD/VIP/VVIP) | `add_client_tags.sql`, `CLIENT_TAGS_GUIDE.md` | `commercial.crm.tags` | Catalogué | Catégorisation client visible dans UI |
| 28 | Contacts (accès contacts téléphone + recherche BDD) | `GUIDE_FONCTIONNALITE_CONTACTS.md` | `commercial.crm.customers` (UI uniquement) | Hors scope (côté web pure) | Permission Web Capacitor à prévoir Phase 2+ |

### 2.2 MLC — Fonctionnalités SANS équivalent Matix (gaps)

| Gap | Module Matix suggéré | Justification |
|---|---|---|
| Salaires livreurs | `operations.hr.payroll` | Module paie/salaires Phase 3 ; aujourd'hui MLC seulement (pas dans catalog) |
| Versements livreur → entreprise (remise cash) | `operations.delivery.cash_remittance` | Pattern : livreur encaisse, reverse en fin de journée. À ne PAS confondre avec `finance.banking.transfers` (mouvement bancaire) |
| Realtime live tracking GPS sur carte (carte Leaflet) | option de `operations.delivery.gps` | UI temps réel ; pas un module mais à mentionner dans la spec |
| Tableau MATA mensuel avec commentaires éditables | option de `analytics.dashboards.custom` | Pattern UX spécifique à conserver dans dashboards ; sinon `analytics.reports.builder` |

---

## 3. Dépenses Management — Comptabilité / Créances / Snapshots

### 3.1 Fonctionnalités auditées

| # | Fonctionnalité Dépenses | Évidence (route/file) | Module Matix | Statut | Notes métier |
|---|---|---|---|---|---|
| 1 | Login + sessions + roles (DG, PCA, directeur, admin, comptable) | `/api/login`, `requireAuth/requireAdminAuth/requireSuperAdmin` | `platform.identity` + `platform.team` | Livré | 5 rôles métier dont `comptable` (read-only finance) |
| 2 | Saisie dépenses avec justificatif upload + 48h edit lock | `/api/expenses` POST/PUT/DELETE, `upload.single('justification')` | `finance.expenses.entry` | Catalogué | Verrou 48h post-création (directeur) ; admin override |
| 3 | Approval workflow dépenses (selection, generate invoices PDF) | `/api/expenses/toggle-selection`, `/api/expenses/generate-invoices-pdf` | `finance.expenses.approval` + `finance.invoicing.pdf` | Catalogué | Pattern : sélectionner N dépenses → générer facture PDF agrégée |
| 4 | Comptes (5 types : classique, créance, fournisseur, partenaire, statut) | `routes accounts/*`, `add_account_types.sql`, `TYPES_COMPTES_GUIDE.md` | `finance.banking.accounts` | Catalogué | `[BR]` 4 types côté Matix vs 5 ici ; à valider : merge `créance` dans `classique` ? |
| 5 | Type compte "statut" : crédit ÉCRASE le solde | `account_type='statut'` | `finance.banking.accounts` (règle) | Catalogué | `[BR]` : lecture-seule, exclu transferts, override DG ; sync auto via trigger PG vers `SOLDE BICTORYS AFFICHE` |
| 6 | Type compte "ajustement/special" : isolé du P&L | `add_account_types.sql`, `migrate_add_special_FINAL.sql`, `EXCLUSION_SOLDE_COMPTES.md` | `finance.banking.accounts` (règle) | Catalogué | Isolé du calcul global P&L ; usage corrections ponctuelles |
| 7 | Crédit historique compte (avec preuve) | `/api/credit-history`, `/api/director/credit-history` | `finance.banking.accounts` (audit) | Catalogué | Lien direct entre crédit et user créditeur |
| 8 | Permissions de crédit (qui peut créditer quel compte) | `/api/accounts/:id/credit-permissions` | `finance.banking.accounts` (RBAC) | Catalogué | Granular : par (account, user) ; pas couvert par roles génériques |
| 9 | Comptes partenaires (max 2 directeurs assignés) | `/api/partner/*`, `routes partner.accounts`, `GUIDE_COMPTES_PARTENAIRES.md` | `finance.partners.accounts` | Catalogué | `[BR]` : permissions hiérarchiques, max 2 directeurs/compte |
| 10 | Livraisons partenaires (workflow create→first-validate→final-validate→reject) | `/api/partner/:accountId/deliveries`, `/api/partner/deliveries/:id/{first,final}-validate` | `finance.partners.deliveries` | Catalogué | `[BR]` étendu : double validation observée (first puis final) — à confirmer avec founder, pas dans BR doc |
| 11 | Génération PDF facture partenaire | `/api/partner/generate-invoice-pdf-direct` | `finance.invoicing.pdf` + `finance.partners.deliveries` | Catalogué | PDF avec liste livraisons validées par période |
| 12 | Créances clients (CRUD + opérations credit/advance/debit) | `/api/creance/:accountId/{clients,operations}` | `finance.receivables.portfolio` | Catalogué | `[BR]` : `solde = crédit_initial + Σavances − Σremboursements`, perms par type op |
| 13 | Dashboard créances (total + monthly) | `/api/dashboard/total-creances`, `/api/dashboard/creances-mois` | `finance.receivables.aging` + `analytics.dashboards.finance` | Catalogué | Pas d'aging buckets explicites côté Dépenses ; à enrichir |
| 14 | Remboursements (autonome + synthèse) | `/api/remboursements`, `/api/remboursements/synthese` | `finance.receivables.portfolio` (op type) | Catalogué | Sous-cas de l'op `debit` |
| 15 | Stock vivant (animaux + aliments, décote 20% par défaut, UNIQUE par date+cat+produit) | `/api/stock-vivant/*`, `routes/stock-vivant`, `STOCK_VIVANT_DEPLOYMENT_GUIDE.md` | `operations.inventory.livestock` | Catalogué | `[BR]` complet : décote 20%, UNIQUE(date,cat,produit), copy-from-date, permissions par directeur |
| 16 | Stock Mata (réconciliation upload JSON depuis Maas) | `/api/stock-mata/*`, `MIGRATION_STOCK_MATA_RESUME.md` | `operations.inventory.levels` (interop) | Catalogué | Pattern : Dépenses ingère le JSON réconciliation Maas ; à remplacer par lecture directe inter-tenant ou via API publique Matix |
| 17 | Cash Bictorys (mensuel : balance, total, upload Excel) | `/api/cash-bictorys/:monthYear`, `/api/external/cash-bictorys` | `finance.payments.mobile_money` (vue agrégée) | Catalogué | Vue mensuelle agrégée Bictorys ; trigger PG sync vers compte statut |
| 18 | Virements mensuels (avec totaux par client) | `/api/virement-mensuel/*` | `finance.banking.transfers` | Catalogué | Vue mensuelle des virements bancaires entrants/sortants |
| 19 | Snapshots quotidiens JSON (P&L, stock écarts, créances, partenaires) | `/api/snapshots/*`, `/external/api/snapshots`, `GUIDE_SNAPSHOTS.md` | `platform.snapshots` | Catalogué | `[BR]` : UNIQUE(date), re-snapshot écrase, lecture-seule ; chrome scraping côté frontend pour P&L visuel |
| 20 | AI Analysis dépenses (GPT-4 sur status financier période) | `/api/ai-analysis`, `AI_ANALYSIS_README.md` | `analytics.ai.insights` | Catalogué | À unifier avec sentiment client (MLC) et veille bétail (Maas) sous `analytics.ai.insights` |
| 21 | P&L visualisation (chrome puppeteer scraping → JSON) | `/api/visualisation/pl-data`, `RENDER_PUPPETEER_SETUP.md` | `analytics.dashboards.finance` | Catalogué | Hack scraping HTML pour générer P&L ; refonte propre via comptabilité double-entry SYSCOHADA |
| 22 | Stock variation visualisation (vivant + PV + solde) | `/api/visualisation/{stock-vivant,stock-pv,solde}-data` | `analytics.dashboards.inventory` + `analytics.dashboards.finance` | Catalogué | Donne la base des dashboards inventory + finance |
| 23 | Audit account flux (timeline mouvements compte) | `/api/audit/account-flux/:accountId` | `finance.banking.accounts` (audit) | Catalogué | Trace chronologique : crédits, dépenses, transferts par compte |
| 24 | Audit consistency (detect + fix-all + fix-account) | `/api/audit/consistency/*`, `/api/admin/force-sync-account/:id` | `platform.audit` + `finance.banking.reconciliation` | Catalogué | Pépite : détection automatique d'incohérences solde calculé vs current_balance |
| 25 | Transferts entre comptes (super-admin only) | `/api/transfert`, `/api/transfers/account/:id` | `finance.banking.transfers` | Catalogué | `[BR]` invariant : compte `statut` exclu, compte `special` interdit |
| 26 | Montant début de mois (par year/month) | `/api/montant-debut-mois/:year/:month`, `create_montant_debut_mois_table.sql` | `finance.accounting.statements` | Catalogué | Snapshot solde 1er du mois pour calculs P&L mensuel |
| 27 | Dashboard stats cards (multi-cards : cash, P&L, charges, écarts, vivant) | `/api/dashboard/stats-cards`, `NOUVELLES_CARTES_DASHBOARD.md` | `analytics.dashboards.finance` | Catalogué | Pattern UX : grille de N cartes paramétrables |
| 28 | Admin SQL query interface (sécurisée, super-admin) | `/api/sql/execute`, `/sql-query` | `platform.tenants_admin` (extension) | Hors scope | Backdoor SQL : à NE PAS porter (risque) ; remplacer par builder reports |
| 29 | Backups automatiques (force-sync, db backups) | `/api/admin/backups`, scripts `backup_prod_to_local.*` | `platform.snapshots` (étendu) ou hors scope | Hors scope | Géré niveau infra Matix (Hetzner + dumps PG) |
| 30 | Configuration catégories dépenses + financial settings JSON | `/api/admin/config/{categories,financial,stock-vivant}` | `platform.settings` | Livré | Pattern : `categories_config.json`, `financial_settings.json` à porter en table `tenant_settings` |
| 31 | Rôle "comptable" (read-only finance) | `add_comptable_role.sql`, `GUIDE_ROLE_COMPTABLE.md` | `platform.team` (rôle) | Livré | Mapper sur Keycloak realm role + perms Matix orthogonales |
| 32 | API externe complète (status, depenses, partenaire, snapshots, creance, virement) | `/external/api/*`, `EXTERNAL_*_API_GUIDE.md` | `platform.api_keys` | Catalogué | Mêmes patterns que Maas/MLC |

### 3.2 Dépenses — Fonctionnalités SANS équivalent Matix (gaps)

| Gap | Module Matix suggéré | Justification |
|---|---|---|
| Type compte "ajustement/special" isolé du P&L | déjà couvert par `finance.banking.accounts` description | Vérifier que la spec mentionne explicitement les 4 types (description l'évoque déjà) |
| Permissions granulaires de crédit par (compte, user) | `finance.banking.accounts` étendu | Pas trivial ; aujourd'hui géré par jointure `account_creditors` ; à intégrer dans le RBAC du module |
| Validation deux étapes livraisons partenaires (first/final-validate) | `finance.partners.deliveries` | À confirmer avec founder : observer dans le code routes `first-validate` puis `final-validate` ; le BR doc ne mentionne qu'une seule validation |
| Cash Bictorys vue mensuelle agrégée | `finance.payments.mobile_money` (vue) | Vue mensuelle distincte de la vue paiement individuel ; à modéliser comme report standard |
| Audit consistency (detect + auto-fix solde) | `finance.banking.reconciliation` | Gap mineur : à ajouter à la spec rapprochement bancaire |
| Snapshot scraping chrome P&L (Puppeteer) | refonte via `finance.accounting.statements` | Hack à supprimer une fois compta double-entry SYSCOHADA livrée |
| Versement livreur → entreprise (cf. MLC #17) | `operations.delivery.cash_remittance` | Mêmes besoins que MLC versements |
| AI analysis financière période | déjà `analytics.ai.insights` | OK ; juste vérifier que le scope englobe finance + clients + market intel |

---

## 4. Workflows n8n externes — couverture et migration

3 workflows n8n hébergés sur instance externe orchestrent des appels HTTP cross-apps + envoient des rapports email quotidiens. Leur fonctionnalité est désormais cataloguée comme modules natifs Matix (à implémenter Phase 2/4). Les JSON sont versionnés dans `infra/n8n-workflows/` pour traçabilité.

### 4.1 Inventaire des workflows

| Workflow | Trigger | État | Sources HTTP | Module Matix cible |
|---|---|---|---|---|
| **MATA BANQ REPORT** | Schedule 23h55 | Inactif | Dépenses `/external/api/status` | `analytics.reports.daily_digest` |
| **MLC N8N GMAIL V2** | Schedule 4h30 | **Actif** | MLC `/api/external/mlc/livreurStats/daily` + `/api/external/v1/orders/mlc-table` | `analytics.reports.daily_digest` |
| **MATA AGENT WEBHOOK ASOFTODAY** | Webhook `GET /webhook/mata-rapport-today` | **Actif** | **16 APIs** : Matix×7, Dépenses×3, MLC×1, Bictorys×2, PoS-CRM×1, autres×2 | `analytics.ai.agent` + `analytics.reports.daily_digest` |

### 4.2 Détail du MATA AGENT WEBHOOK (le plus instructif)

36 nodes n8n, 16 HttpRequest en parallèle, génère un rapport complet à la demande :

**APIs Matix/Maas** (`mata-lgzy.onrender.com`) :
- `/api/external/reconciliation` (×3 — pour différents calculs)
- `/api/external/achats-boeuf`
- `/api/external/estimation`
- `/api/external/analytics`
- `/api/external/performance-achat`
- `/api/external/gestionStock`
- `/api/external/reconciliation/aggregated`

**APIs Dépenses Management** (`mata-depenses-management.onrender.com`) :
- `/external/api/creance`
- `/external/api/status`
- `/external/api/virement`

**APIs MLC** (`matix-livreur-backend.onrender.com`) :
- `/api/external/mlc/livreurStats/daily`

**APIs Bictorys** (`api.bictorys.com`) :
- `/balance-management/v1/balance/me`
- `/pay/v1/transactions/amount`

**Autres** :
- `matapointdeventecrm.onrender.com/api/external/point-vente/status`

**Output** : Email "MATA REPORT 1: Ventes et Stock {date}" + réponse JSON au webhook.

### 4.3 Plan de migration

| Étape | Statut | Modules concernés |
|---|---|---|
| 1. Sauvegarde JSON workflows dans repo | ✅ Fait | — |
| 2. Catalogage modules cibles (catalog.ts) | ✅ Fait | `platform.integrations`, `platform.workflows`, `analytics.ai.agent`, `analytics.reports.daily_digest` |
| 3. Implémentation `analytics.reports.daily_digest` | 🔜 Phase 2 | Remplace MATA BANQ REPORT + MLC N8N GMAIL V2 |
| 4. Implémentation `analytics.ai.agent` | 🔜 Phase 2 | Remplace MATA AGENT WEBHOOK (devient endpoint REST + chat IA) |
| 5. Implémentation `platform.workflows` | 🔜 Phase 4 | Permet aux tenants de créer leurs propres automations sans n8n externe |
| 6. Décommissionnement instance n8n externe | 🔜 Phase 4 | Une fois 3-4-5 livrés |

---

## 5. Synthèse — Gaps prioritaires (à ajouter au catalogue Matix)

| # | Fonctionnalité | App source | Module Matix suggéré | Pilier | Phase | Priorité |
|---|---|---|---|---|---|---|
| G1 | Pré-commandes / commande téléphonique avant retrait | Maas | `commercial.sales.preorders` | commercial | 1 | Haute |
| G2 | Traçabilité viande lot → PV → ticket | Maas | `operations.procurement.traceability` | operations | 3 | Moyenne |
| G3 | Versement / remise cash livreur → entreprise | MLC + Maas | `operations.delivery.cash_remittance` | operations | 2 | Haute (cœur métier livraison) |
| G4 | Salaires / paie livreurs | MLC | `operations.hr.payroll` | operations | 3 | Moyenne |
| G5 | Verrou temporel paramétrable (J+N hh:mm) | Maas | option `platform.settings.edit_lock_hours` | platform | 1 | Haute (généralise restriction NADOU/PAPI) |
| G6 | Découpe / forwarding centres | Maas | sous-feature de `operations.procurement.slaughter` (étendre `description_fr`) | operations | 3 | Moyenne |
| G7 | Realtime / SSE dashboards | Maas + MLC | option transverse aux `analytics.dashboards.*` (à mentionner dans la spec) | analytics | 2 | Moyenne |
| G8 | Audit consistency (auto-detect/fix soldes) | Dépenses | `finance.banking.reconciliation` (étendre description) | finance | 3 | Moyenne |
| G9 | Tableau mensuel client avec commentaires éditables | MLC (MATA) | option de `analytics.dashboards.custom` ou `analytics.reports.builder` | analytics | 2 | Faible (UX spécifique) |
| G10 | Validation deux étapes (first/final) livraisons partenaires | Dépenses | étendre `finance.partners.deliveries` description | finance | 3 | Moyenne (vérifier avec founder) |
| **G11** | **Agent IA conversationnel multi-API** | **n8n MATA AGENT** | **`analytics.ai.agent`** ✅ AJOUTÉ catalogue | **analytics** | **2** | **Haute** |
| **G12** | **Rapports email quotidiens (digest agrégé)** | **n8n MATA REPORT 1/2 + MATA BANQ** | **`analytics.reports.daily_digest`** ✅ AJOUTÉ catalogue | **analytics** | **2** | **Haute** |
| **G13** | **Hub intégrations tierces (Gmail/Bictorys/Slack/...)** | **n8n + ad-hoc dans 3 apps** | **`platform.integrations`** ✅ AJOUTÉ catalogue | **platform** | **2** | **Moyenne** |
| **G14** | **Workflows managés (3 templates Matix paramétrables par tenant, n8n caché)** | **n8n externe** | **`platform.workflows`** ✅ AJOUTÉ catalogue (Phase 2, n8n DURABLE comme engine) | **platform** | **2** | **Haute** |

**Note** : Sur les 14 gaps identifiés, **5 ont nécessité un nouveau code module** au catalogue (G3 cash_remittance + G11 ai.agent + G12 daily_digest + G13 integrations + G14 workflows). Les 4 derniers (G11-G14) ont déjà été ajoutés au catalogue (mai 2026, cf. migration `0010_n8n_inspired_modules.sql`). Les autres gaps sont soit des extensions de modules existants (description_fr à enrichir), soit des options UX/config.

---

## 6. Modules Matix nouveaux (sans équivalent legacy)

Modules du catalogue qui n'existent dans aucune app Mata existante — vraies nouveautés post-unification.

| Module Matix | Pilier | Justification | Phase |
|---|---|---|---|
| `platform.tenants_admin` | platform | Multi-tenant SaaS — Mata mono-tenant | 0 (livré) |
| `platform.licensing` (interne, via `tenant_licenses`) | platform | Plans + activation par tenant — neuf | 0 (livré) |
| `platform.api_keys` (formalisé) | platform | Maas/MLC/Dépenses ont des API keys ad-hoc ; Matix le centralise | 1 |
| `platform.webhooks` | platform | Aucune des 3 apps n'a de webhooks sortants | 4 |
| `platform.notifications` | platform | Aucune notif unifiée ; chaque app fait ad-hoc (push livreur, email) | 1-2 |
| `platform.files` (R2 unifié) | platform | Maas/MLC/Dépenses : uploads locaux disque ; Matix = R2 | 1 |
| `commercial.crm.segments` | commercial | Segmentation client formelle — non dans MLC/Maas | 2 |
| `commercial.sales.discounts` | commercial | Remises et codes promo — non utilisés Mata | 1 |
| `commercial.sales.loyalty` | commercial | Cartes de fidélité — non Mata (vs cartes MLC qui sont des subscriptions) | 2 |
| `commercial.pricing.promotions` | commercial | Prix promo — non Mata | 2 |
| `operations.inventory.alerts` | operations | Alertes seuils — non Mata | 2 |
| `operations.inventory.counts` | operations | Inventaires physiques formalisés — non Mata | 2 |
| `operations.inventory.valuation` | operations | Valorisation FIFO/CMP — Mata ad-hoc via prix moyen | 3 |
| `operations.procurement.purchase_orders` | operations | BdC formalisés — non Mata (achats bœuf = process unique) | 3 |
| `operations.procurement.suppliers` | operations | Fournisseurs structurés — non Mata | 3 |
| `operations.procurement.receiving` | operations | Réception marchandises — non Mata | 3 |
| `operations.delivery.routes` | operations | Optimisation tournées — non MLC | 2 |
| `operations.delivery.proof_of_delivery` | operations | Signature + photo geo-taggée formelle — partiel MLC (attachments) | 2 |
| `operations.hr.schedules` | operations | Planning shifts — non Mata | 2 |
| `finance.accounting.gl` | finance | Grand livre SYSCOHADA double-entry — Mata = single-entry partout | 3 |
| `finance.accounting.statements` | finance | Bilan + P&L conformes — Mata = chrome scraping | 3 |
| `finance.accounting.tax` | finance | Déclarations TVA — non Mata | 3 |
| `finance.invoicing.invoices` | finance | Factures B2B formelles — partiel Mata (génération PDF dépenses) | 1 |
| `finance.invoicing.tickets` | finance | Tickets de caisse formalisés — Mata = print-direct ad-hoc | 1 |
| `finance.invoicing.credit_notes` | finance | Avoirs — non Mata | 1 |
| `finance.payments.cards` | finance | Cartes bancaires — non Mata | 1 |
| `finance.payables.aging` | finance | État âgé fournisseurs — non Mata | 3 |
| `analytics.reports.scheduled` | analytics | Rapports planifiés (cron + email) — non Mata | 2 |
| `analytics.reports.builder` | analytics | Constructeur de rapports drag-and-drop — non Mata | 3 |
| `analytics.ai.forecasting` | analytics | Prévisions IA — non Mata (sentiment + insights existent) | 3 |
| `analytics.ai.agent` | analytics | Agent conversationnel multi-API — successeur du webhook n8n MATA AGENT | 2 |
| `analytics.reports.daily_digest` | analytics | Rapport email quotidien agrégé — natif (vs 3 workflows n8n actuels) | 2 |
| `platform.integrations` | platform | Hub intégrations tierces (Gmail, Bictorys, Slack, OpenAI) — centralise credentials + webhooks | 2 |
| `platform.workflows` | platform | Orchestrateur natif (alternative à n8n externe) — triggers/actions/conditions | 4 |

---

## 7. Recommandations roadmap

### Priorisation Phase 1 (MVP vendable — 5 mois, en cours)

Le catalogue Matix est aligné sur le périmètre Maas + Bictorys. Pour la Phase 1, finir ce qui est `coming-soon` mais issu de Maas :
1. `commercial.sales.cash_closure` + `commercial.sales.reconciliation` (formule Pération abattage `[BR]`)
2. `finance.payments.mobile_money` (Bictorys multi-opérateurs — pattern d'intégration Maas déjà éprouvé : import aggregated + manual + ref-mapping V_/A_ par PV)
3. `commercial.pricing.lists` + `commercial.pricing.history` (pattern Maas : prix par PV, payment_ref par PV)
4. `finance.invoicing.tickets` (Maas = print-direct ; Matix doit générer PDF + ESC/POS optionnel)
5. **Gap G5** (verrou temporel paramétrable) — petit dev, gros impact ; à intégrer dans `platform.settings`
6. **Gap G1** (pré-commandes) — déjà 9 endpoints dans Maas, use case fréquent boucherie

### Priorisation Phase 2 (Verticale logistique — 3 mois)

Cœur MLC. Bien noter que `[BR]` couvre déjà : scoring, GPS, timesheets (photo OBLIGATOIRE start/end), expenses (createOrUpdate UNIQUE).
1. `operations.delivery.{orders,drivers,gps,scoring,proof_of_delivery,bidirectional_ratings}` — la matière première MLC est dense (44 routes orders, 12 endpoints GPS analytics)
2. `operations.hr.{timesheets,expenses}` — `[BR]` complets, à porter avec attention au pattern createOrUpdate (UNIQUE livreur+date)
3. `commercial.subscriptions.plans` — penser DUAL pattern : carte MLC (N livraisons) + abonnement Maas (mensuel `YYYY-MM`)
4. **Gap G3** (cash remittance livreur) — à ajouter au catalogue avant ou pendant Phase 2 (cœur métier livraison)
5. **Gap G7** (realtime SSE) — option transverse à mentionner dans la spec dashboards

### Priorisation Phase 3 (Verticale finance SYSCOHADA — 4 mois)

C'est la plus grosse refonte conceptuelle. Dépenses Management est en single-entry ; Matix passe en double-entry strict.
1. `finance.accounting.gl` — Grand Livre. Pas de port direct, refonte conceptuelle
2. `finance.banking.accounts` (4 types `[BR]`) + `finance.banking.{reconciliation,transfers}` — port direct + invariants stricts (compte statut exclu, special isolé)
3. `finance.partners.{accounts,deliveries}` — port direct + `[BR]` ; CONFIRMER avec founder le workflow first-validate/final-validate (présent dans le code mais pas dans BR doc)
4. `finance.receivables.{aging,reminders,portfolio}` — port direct depuis Dépenses
5. `finance.expenses.{entry,approval,ocr}` — OCR déjà fonctionnel côté Maas
6. `operations.inventory.livestock` (`[BR]` complet) + `operations.inventory.unit_conversion` (`[BR]` historisation rétroactive)
7. `operations.procurement.slaughter` + `commercial.sales.performance_audit` (`[BR]`) — duo bœuf inseparable

### Pépites métier à NE PAS oublier

À chaque module Phase 2/3, relire la fiche `[BR]` AVANT d'implémenter. En particulier :
- **Pération abattage** : un seul PV concerné, mais formule différente. Source de bugs si ignoré.
- **Score performance achat x2 surestimation** : pénalise différemment la fraude vs l'erreur honnête.
- **Conversion unit→kg historisée** : si admin change rétroactivement, intégrité historique préservée.
- **Stock vivant décote 20%** : seul module avec `total = qty × prix × (1 - decote)`.
- **Compte `statut` exclu transferts + override DG** : invariant strict, jamais à contourner.
- **Snapshot UNIQUE par jour** : re-snapshot écrase. Pas d'historique multi-versions.
- **Pointage photo OBLIGATOIRE start ET end** : règle forte MLC, pas un nice-to-have.
- **Modification timesheet livreur 15min seulement** : règle anti-fraude.

### Risques de scope creep

- **Multiplication des dashboards** : Maas, MLC et Dépenses ont chacun leurs dashboards spécifiques. Tentation d'avoir un dashboard par "ancien produit" plutôt qu'unifier dans `analytics.dashboards.{sales,inventory,finance}` + custom.
- **API externes legacy** : ~30 endpoints `/external/*` côté Maas, ~15 côté MLC, ~10 côté Dépenses. Tentation de tous les recréer. → Migrer progressivement, exposer via `platform.api_keys` + une seule API publique OpenAPI documentée (Phase 4).
- **Workflow validation à étapes multiples** : observer le pattern first-validate/final-validate pour livraisons partenaires (Dépenses). Risque de sur-engineer un BPMN générique alors qu'on veut juste 2 transitions.
- **AI analysis dispersée** : 3 features IA différentes (sentiment client MLC, veille bétail Maas, AI analysis dépenses). Garder UN module `analytics.ai.insights` qui les ré-applique avec contexte différent, pas 3 modules distincts.
- **Type compte `créance` (Dépenses 5e type) vs `[BR]` Matix (4 types)** : à arbitrer. Probablement OK de fusionner avec `classique` + jointure `account_creditors` pour les multi-créditeurs.
- **Rôles legacy spécifiques** (NADOU, PAPI, comptable, livreur) : à mapper sur Keycloak realm roles + perms orthogonales Matix (ADR-0006), PAS dupliquer comme rôles métier dans le code.

---

## Annexe — Référence rapide
- Catalogue source de vérité : `apps/api/src/modules/licensing/catalog.ts`
- Pépites métier détaillées : `docs/business-rules-catalog.md` (formules, workflows, invariants)
- ADR catalogue : `docs/adr/0005-module-catalog.md`, `docs/adr/0007-catalog-deepaudit-update.md`
- État livraison : `README.md` section "État détaillé"
