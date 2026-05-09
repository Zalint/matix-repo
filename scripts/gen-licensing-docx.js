/* eslint-disable */
/**
 * Génère docs/matix-licensing-and-modules.docx
 *
 * Document Word professionnel sur l'architecture des modules et licences Matix :
 *  - Concepts clés, schémas, flow
 *  - Catalogue exhaustif des 84 modules par pilier
 *  - 4 plans commerciaux détaillés
 *  - Parallèle avec Maas App / MLC / Dépenses Management
 *  - Exemples concrets (onboarding, add-on, upgrade)
 *
 * Lancement: node scripts/gen-licensing-docx.js
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType, VerticalAlign,
  PageNumber, PageBreak, TableOfContents, TabStopType, TabStopPosition,
} = require('docx');

// ============================================================================
// DATA — Catalogue, plans, mapping legacy
// ============================================================================

const MODULES_BY_PILLAR = {
  Platform: [
    ['platform.identity',         'Identité',                'active',       'read',                   'Authentification, sessions, profil'],
    ['platform.team',             'Équipe',                  'active',       'read,write,delete',      'Membres tenant, rôles RBAC'],
    ['platform.tenants_admin',    'Administration tenants',  'active',       'read,write,delete',      'Provisioning + gestion super-admin'],
    ['platform.audit',            'Audit logs',              'coming-soon',  'read',                   'Trail multi-tenant (qui/quoi/quand)'],
    ['platform.notifications',    'Notifications',           'coming-soon',  'read,write',             'Push, email, in-app'],
    ['platform.files',            'Fichiers',                'coming-soon',  'read,write,delete',      'Stockage R2, photos, documents'],
    ['platform.api_keys',         'Clés API',                'coming-soon',  'read,write,delete',      'Exposition API publique'],
    ['platform.webhooks',         'Webhooks',                'coming-soon',  'read,write,delete',      'Notifications sortantes'],
    ['platform.settings',         'Paramètres tenant',       'active',       'read,write',             'Config catégories, financial settings, edit_lock_hours'],
    ['platform.billing',          'Facturation Matix',       'coming-soon',  'read',                   'Vue facture côté tenant'],
    ['platform.snapshots',        'Snapshots',               'coming-soon',  'read',                   'Snapshots quotidiens JSON (P&L, créances)'],
    ['platform.integrations',     'Intégrations tierces',    'coming-soon',  'read,write,delete',      'Hub Gmail/Bictorys/Wave/OM/Slack/OpenAI : credentials, webhooks, normalisation'],
    ['platform.workflows',        'Workflows / automations', 'coming-soon',  'read,write',             'Modèle managé : Matix livre 3 templates, le tenant configure (cron, destinataires) sans pouvoir créer. Engine n8n caché derrière UI Matix'],
  ],
  Commercial: [
    ['commercial.crm.customers',         'Clients',                  'active',       'read,write,delete', 'CRUD clients, recherche par nom/téléphone'],
    ['commercial.crm.segments',          'Segments clients',         'coming-soon',  'read,write,delete', 'Segmentation pour marketing'],
    ['commercial.crm.tags',              'Tags clients',             'coming-soon',  'read,write,delete', 'STANDARD/VIP/VVIP (issu MLC)'],
    ['commercial.crm.credits',           'Crédits clients',          'coming-soon',  'read,write,delete', 'Avances, remboursements, optimistic locking'],
    ['commercial.crm.communications',    'Historique communications','coming-soon',  'read,write',        'Audit client, commentaires + sentiment IA'],
    ['commercial.sales.pos',             'Caisse / POS',             'active',       'read,write,delete', 'Encaissement, panier, multi-paiement'],
    ['commercial.sales.cash_closure',    'Clôture de caisse',        'coming-soon',  'read,write',        'Estimatif puis final, day screening'],
    ['commercial.sales.reconciliation',  'Réconciliation ventes',    'coming-soon',  'read,write',        'Pération abattage : (VT/StockMatin)*100'],
    ['commercial.sales.performance_audit','Audit performance achats','coming-soon',  'read,write,delete', 'Score x2 surestim, cohérence ±0.5kg, verrou 24h'],
    ['commercial.sales.discounts',       'Remises et codes promo',   'coming-soon',  'read,write,delete', 'Remises, codes, périodes'],
    ['commercial.sales.loyalty',         'Cartes de fidélité',       'coming-soon',  'read,write,delete', 'Programme fidélité points'],
    ['commercial.subscriptions.plans',   'Plans d\'abonnement',      'coming-soon',  'read,write,delete', 'Cartes MLC + abonnements mensuels Maas'],
    ['commercial.subscriptions.billing', 'Facturation récurrente',   'coming-soon',  'read,write',        'Prélèvements automatiques mensuels'],
    ['commercial.pricing.lists',         'Tarifs par PV',            'coming-soon',  'read,write,delete', 'Liste prix + payment_ref par point de vente'],
    ['commercial.pricing.history',       'Historique des prix',      'coming-soon',  'read',              'Prix moyen pondéré, retry décalage'],
    ['commercial.pricing.promotions',    'Prix promo',               'coming-soon',  'read,write,delete', 'Promotions limitées dans le temps'],
  ],
  Operations: [
    ['operations.inventory.levels',          'Stocks par PV',           'active',       'read,write',        'Niveau de stock matin/soir par PV'],
    ['operations.inventory.movements',       'Mouvements de stock',     'active',       'read,write',        'Décrément atomique sur ventes + transferts'],
    ['operations.inventory.transfers',       'Transferts inter-PV',     'coming-soon',  'read,write,delete', 'Transferts entre points de vente'],
    ['operations.inventory.valuation',       'Valorisation stock',      'coming-soon',  'read',              'FIFO/CMP, valeur stock à date'],
    ['operations.inventory.alerts',          'Alertes seuils',          'coming-soon',  'read,write',        'Alertes stock bas, ruptures'],
    ['operations.inventory.counts',          'Inventaires physiques',   'coming-soon',  'read,write',        'Comptages périodiques'],
    ['operations.inventory.livestock',       'Stock vivant',            'coming-soon',  'read,write,delete', 'Animaux + aliments, décote 20%, UNIQUE(date,cat,prod)'],
    ['operations.inventory.unit_conversion', 'Conversion unité ↔ kg',  'coming-soon',  'read,write',        'Historisé par date (intégrité rétroactive)'],
    ['operations.procurement.purchase_orders','Bons de commande',       'coming-soon',  'read,write,delete', 'BdC fournisseurs'],
    ['operations.procurement.suppliers',     'Fournisseurs',            'coming-soon',  'read,write,delete', 'Fichier fournisseurs + conditions'],
    ['operations.procurement.receiving',     'Réception marchandises',  'coming-soon',  'read,write',        'Réception + contrôle vs BdC'],
    ['operations.procurement.slaughter',     'Achats bœuf / découpe',   'coming-soon',  'read,write,delete', 'Process abattage Mata + découpe'],
    ['operations.delivery.orders',           'Commandes livraison',     'coming-soon',  'read,write,delete', '~30 endpoints MLC : CRUD, dashboard, by-date'],
    ['operations.delivery.drivers',          'Livreurs',                'coming-soon',  'read,write,delete', 'Profil livreur + statut + scooter'],
    ['operations.delivery.gps',              'GPS / géofencing',        'coming-soon',  'read,write',        '5 zones Sénégal, rayon 100m, métriques quotidiennes'],
    ['operations.delivery.routes',           'Tournées',                'coming-soon',  'read,write',        'Optimisation tournées'],
    ['operations.delivery.scoring',          'Scoring livreurs',        'coming-soon',  'read',              '(bénéfice×0.0003)+(km×W)+(pointages×0.5)'],
    ['operations.delivery.proof_of_delivery','Preuve de livraison',     'coming-soon',  'read,write',        'Photo + signature + geo-tag'],
    ['operations.delivery.bidirectional_ratings','Évaluations bidirectionnelles','coming-soon','read,write','Livreur ↔ client (risque, qualité, paiement)'],
    ['operations.hr.timesheets',             'Pointages',               'coming-soon',  'read,write',        'Photo OBLIGATOIRE start+end, modif livreur 15min'],
    ['operations.hr.expenses',               'Dépenses agent',          'coming-soon',  'read,write,delete', 'Carburant/réparation/police, UNIQUE(livreur,date)'],
    ['operations.hr.schedules',              'Planning',                'coming-soon',  'read,write',        'Shifts, plannings hebdomadaires'],
  ],
  Finance: [
    ['finance.accounting.gl',          'Plan comptable & journaux','coming-soon', 'read,write,delete', 'Grand Livre SYSCOHADA double-entry'],
    ['finance.accounting.statements',  'États financiers',         'coming-soon', 'read',              'Bilan, P&L, conformes OHADA'],
    ['finance.accounting.tax',         'Déclarations TVA',         'coming-soon', 'read,write',        'TVA + déclarations fiscales'],
    ['finance.expenses.entry',         'Saisie dépenses',          'coming-soon', 'read,write,delete', 'Dépenses + justif upload, edit lock 48h'],
    ['finance.expenses.approval',      'Validation dépenses',      'coming-soon', 'read,write',        'Workflow toggle-selection + génération PDF'],
    ['finance.expenses.ocr',           'OCR justificatifs',        'coming-soon', 'read,write',        'Extraction automatique tickets/factures'],
    ['finance.receivables.aging',      'État âgé créances',        'coming-soon', 'read',              'Aging buckets 30/60/90'],
    ['finance.receivables.reminders',  'Relances',                 'coming-soon', 'read,write',        'Relances automatiques clients'],
    ['finance.receivables.portfolio',  'Portfolio créances',       'coming-soon', 'read,write',        'solde = crédit + Σavances - Σremboursements'],
    ['finance.payables.aging',         'État âgé fournisseurs',    'coming-soon', 'read',              'Dette fournisseur par maturité'],
    ['finance.invoicing.invoices',     'Factures B2B',             'coming-soon', 'read,write,delete', 'Factures B2B avec statut'],
    ['finance.invoicing.tickets',      'Tickets de caisse',        'coming-soon', 'read,write',        'Tickets POS (PDF + ESC/POS)'],
    ['finance.invoicing.credit_notes', 'Avoirs',                   'coming-soon', 'read,write',        'Avoirs / notes de crédit'],
    ['finance.invoicing.pdf',          'Génération PDF',           'coming-soon', 'read',              'Rendu PDF unifié'],
    ['finance.banking.accounts',       'Comptes bancaires',        'coming-soon', 'read,write,delete', '4 types : classique, partenaire, statut, special'],
    ['finance.banking.reconciliation', 'Rapprochement bancaire',   'coming-soon', 'read,write',        'Rapprochement + détection incohérences'],
    ['finance.banking.transfers',      'Virements',                'coming-soon', 'read,write,delete', 'Compte statut exclu, special interdit'],
    ['finance.payments.mobile_money',  'Mobile Money (Bictorys)',  'coming-soon', 'read,write',        'Wave, Orange Money, MTN MoMo via Bictorys'],
    ['finance.payments.cards',         'Cartes bancaires',         'coming-soon', 'read,write',        'Visa, Mastercard'],
    ['finance.payments.cash',          'Espèces',                  'active',      'read,write',        'Encaissement cash classique'],
    ['finance.partners.accounts',      'Comptes partenaires',      'coming-soon', 'read,write,delete', 'Max 2 directeurs/compte, perms granulaires'],
    ['finance.partners.deliveries',    'Livraisons partenaires',   'coming-soon', 'read,write',        'Workflow create→first-validate→final-validate'],
  ],
  Analytics: [
    ['analytics.dashboards.sales',      'Dashboard ventes',         'coming-soon', 'read',              'KPIs ventes, marges, ratios'],
    ['analytics.dashboards.inventory',  'Dashboard stock',          'coming-soon', 'read',              'Niveaux, écarts, valorisation'],
    ['analytics.dashboards.finance',    'Dashboard finance',        'coming-soon', 'read',              'P&L, créances, partenaires'],
    ['analytics.dashboards.custom',     'Dashboards personnalisés', 'coming-soon', 'read,write,delete', 'Constructeur drag-and-drop'],
    ['analytics.reports.standard',      'Rapports standard',        'coming-soon', 'read',              'Rapports prédéfinis'],
    ['analytics.reports.scheduled',     'Rapports planifiés',       'coming-soon', 'read,write',        'Cron + email PDF/Excel'],
    ['analytics.reports.daily_digest',  'Rapport quotidien digest', 'coming-soon', 'read,write',        'Email auto agrégeant CA/stock/créances/dépenses/MLC depuis modules Matix'],
    ['analytics.reports.builder',       'Constructeur de rapports', 'coming-soon', 'read,write,delete', 'Builder no-code'],
    ['analytics.ai.insights',           'Insights IA',              'coming-soon', 'read',              'GPT-4 sur dépenses + sentiment client + veille'],
    ['analytics.ai.forecasting',        'Prévisions IA',            'coming-soon', 'read',              'Prévisions ventes/stock'],
    ['analytics.ai.agent',              'Agent IA conversationnel', 'coming-soon', 'read',              'LLM + tools HTTP : "CA aujourd\'hui ?", "meilleur livreur ?". Successeur du webhook MATA AGENT'],
    ['analytics.market_intelligence',   'Veille marché',            'coming-soon', 'read',              'RSS Mali/Mauritanie + GPT alertes (cache 12h)'],
    ['analytics.exports.excel',         'Export Excel',             'coming-soon', 'read',              'Export XLSX paramétrable'],
    ['analytics.exports.csv',           'Export CSV',               'coming-soon', 'read',              'Export CSV brut'],
    ['analytics.exports.pdf',           'Export PDF',               'coming-soon', 'read',              'Export rapports PDF'],
  ],
  Marketplace: [
    // Vide — réservé Phase 4
  ],
};

// Mapping module Matix → fonctionnalités équivalentes dans les 3 apps Mata legacy
// Source : docs/feature-coverage-vs-mata-apps.md (audit 94 fonctionnalités)
// Format : [maas, mlc, depenses] — chaîne vide si pas d'équivalent ; "(nouveau)" si vraiment neuf
const LEGACY_MAP = {
  // ─── Platform ──────────────────────────────────────────────────
  'platform.identity':         ['/api/login + sessions multi-PV (routes/auth.js, table user_points_vente)', 'Auth JWT login/logout/refresh (routes/auth.js, controllers/authController.js)', '/api/login + requireAuth/requireAdminAuth (5 rôles : DG, PCA, directeur, admin, comptable)'],
  'platform.team':             ['/api/admin/users/* CRUD + toggle + default-screen', 'routes/users.js (4 rôles ADMIN/MANAGER/LIVREUR/VIEWER)', 'Rôles + add_comptable_role.sql (read-only finance)'],
  'platform.tenants_admin':    ['— (Mata mono-tenant)', '— (MLC mono-tenant)', '— (Dépenses mono-tenant)'],
  'platform.audit':            ['routes/auditLogs.js, table audit_logs (qui/quoi/quand)', '—', '/api/audit/account-flux + /api/audit/consistency (auto-fix soldes)'],
  'platform.notifications':    ['— (ad-hoc emails)', '— (push livreur ad-hoc)', '— (ad-hoc)'],
  'platform.files':            ['Uploads disque local', 'routes/attachments.js, table order_attachments (photos livraison)', 'upload.single("justification") sur /api/expenses'],
  'platform.api_keys':         ['validateApiKey + ~30 endpoints /api/external/*', 'validateApiKey dans external.js (1280 lignes)', '/external/api/* (~10 endpoints, EXTERNAL_*_API_GUIDE.md)'],
  'platform.webhooks':         ['—', '—', '—'],
  'platform.settings':         ['routes/config-admin.js (50ko), routes/modules.js, restrictions temporelles NADOU/PAPI', '—', '/api/admin/config/{categories,financial,stock-vivant}'],
  'platform.billing':          ['—', '—', '—'],
  'platform.snapshots':        ['—', '—', '/api/snapshots/* + GUIDE_SNAPSHOTS.md (P&L, créances, partenaires JSON quotidien)'],
  'platform.integrations':     ['Bictorys (cash-payments, payment-links) + Gmail SMTP ad-hoc', 'Bictorys + Gmail SMTP ad-hoc', 'Bictorys + Gmail SMTP ad-hoc + OpenAI key (AI analysis)'],
  'platform.workflows':        ['— (n8n externe : MATA BANQ REPORT, MATA AGENT WEBHOOK)', '— (n8n externe : MLC N8N GMAIL V2)', '— (consommé par les workflows n8n externes)'],

  // ─── Commercial ────────────────────────────────────────────────
  'commercial.crm.customers':      ['Catalog clients (light)', 'getClientByPhone + searchClients (CRM par téléphone)', 'Clients liés aux comptes créance (/api/creance)'],
  'commercial.crm.segments':       ['—', '—', '—'],
  'commercial.crm.tags':           ['—', 'add_client_tags.sql (STANDARD/VIP/VVIP) + CLIENT_TAGS_GUIDE.md', '—'],
  'commercial.crm.credits':        ['/api/credit/use, /api/credit/refund, /api/commandes/:id/credit', 'routes/clientCredits.js (optimistic locking via version)', 'Créances dans /api/creance/:accountId/operations'],
  'commercial.crm.communications': ['/api/audit-client + table AuditClientLog (historique commandes/paiements par phone)', 'routes/audit.js + deepAnalysisController.js (sentiment IA, cache 6h)', '—'],

  'commercial.sales.pos':           ['/api/ventes (POST/GET/PUT/DELETE), /api/ventes/jour/:date, routes/ventes.js', '—', '—'],
  'commercial.sales.cash_closure':  ['/api/clotures-caisse + /api/clotures-caisse/estimatif + /api/day-screening', '—', '—'],
  'commercial.sales.reconciliation':['/api/reconciliation/save + load + external. Formule Pération abattage : (VT/StockMatin)×100', '—', '/api/stock-mata/* (ingère le JSON réconciliation Maas)'],
  'commercial.sales.performance_audit':['/api/performance-achat (estimation vs réel, score x2 surestim, verrou 24h, cohérence ±0.5kg)', '—', '—'],
  'commercial.sales.discounts':     ['—', '—', '—'],
  'commercial.sales.loyalty':       ['—', '— (à ne PAS confondre avec subscriptions = cartes livraison)', '—'],

  'commercial.subscriptions.plans':  ['routes/abonnements.js (mensuels YYYY-MM), models/ClientAbonne.js', 'routes/subscriptions.js (cartes MLC-YYYY-NNNN, 10 livraisons/6 mois)', '—'],
  'commercial.subscriptions.billing':['models/PaiementAbonnement.js (prélèvements mensuels)', 'Décrémentation remaining_deliveries à chaque commande', '—'],

  'commercial.pricing.lists':       ['Prix par PV + payment_ref V_/A_ (mapping Bictorys) — déjà en BDD Maas', '—', '—'],
  'commercial.pricing.history':     ['/api/prix-moyen + /api/test-prix-moyen (moyenne pondérée par kg, période glissante)', '—', '—'],
  'commercial.pricing.promotions':  ['—', '—', '—'],

  // ─── Operations ────────────────────────────────────────────────
  'operations.inventory.levels':    ['/api/stock/:type (matin/soir avec auto-calc pour mode_stock=automatique)', '—', '/api/stock-mata/* (ingère stock Maas) + /api/stock-vivant/*'],
  'operations.inventory.movements': ['Mouvements stock + cron 5h UTC copie soir J→matin J+1 (STOCK_COPY_AUTOMATION_README.md)', '—', '—'],
  'operations.inventory.transfers': ['/api/transferts (saisie inter-PV)', '—', '—'],
  'operations.inventory.valuation': ['—', '—', '/api/external/stock-soir-marge (valeur stock + marge)'],
  'operations.inventory.alerts':    ['—', '—', '—'],
  'operations.inventory.counts':    ['—', '—', '—'],
  'operations.inventory.livestock': ['—', '—', '/api/stock-vivant/* + STOCK_VIVANT_DEPLOYMENT_GUIDE (décote 20%, UNIQUE date+cat+produit, copy-from-date)'],
  'operations.inventory.unit_conversion':['/api/estimations + /api/weight-params/:date (boeuf=150kg, veau=110kg, etc.) — historisé par date', '—', '—'],

  'operations.procurement.purchase_orders':['—', '—', '—'],
  'operations.procurement.suppliers':      ['—', '—', '—'],
  'operations.procurement.receiving':      ['—', '—', '—'],
  'operations.procurement.slaughter':      ['/api/achats-boeuf (CRUD + stats monthly), models/AchatBoeuf.js + routes/decoupe-forward.js', '—', '—'],

  'operations.delivery.orders':       ['/api/commandes/statut + /api/weborders/* (file→assign→convert→archive)', 'routes/orders.js (44 routes !), controllers/orderController.js', '—'],
  'operations.delivery.drivers':      ['/api/livreur/*', 'routes/users.js (rôle LIVREUR) + GUIDE_AJOUT_LIVREUR.md', '—'],
  'operations.delivery.gps':          ['—', 'routes/gps.js + mlc_zones (5 zones SN) + gps_daily_metrics + GUIDE_TRACKING_HORAIRE.md', '—'],
  'operations.delivery.routes':       ['—', '—', '—'],
  'operations.delivery.scoring':      ['—', 'routes/ranking.js + calcul orderController : (bénéfice×0.0003)+(km×W)+(pointages×0.5)', '—'],
  'operations.delivery.proof_of_delivery':['—', 'Partiel : photos via attachments + rating (pas de POD formalisé)', '—'],
  'operations.delivery.bidirectional_ratings':['—', 'PUT /:id/rating + add_rating_columns.sql + add_average_rating.sql', '—'],

  'operations.hr.timesheets':       ['—', 'routes/timesheets.js + DESIGN_POINTAGE_LIVREURS.md (photos start+end OBLIGATOIRES, modif livreur 15min)', '—'],
  'operations.hr.expenses':         ['—', 'routes/expenses.js (carburant, réparations, police, autres + km — UNIQUE livreur+date)', '—'],
  'operations.hr.schedules':        ['—', '—', '—'],

  // ─── Finance ───────────────────────────────────────────────────
  'finance.accounting.gl':          ['—', '—', '— (Mata = single-entry partout — Matix passe à SYSCOHADA double-entry)'],
  'finance.accounting.statements':  ['—', '—', '/api/visualisation/pl-data (chrome puppeteer scraping HTML pour P&L)'],
  'finance.accounting.tax':         ['—', '—', '—'],

  'finance.expenses.entry':         ['—', '—', '/api/expenses POST/PUT/DELETE + upload justificatif + edit lock 48h post-création'],
  'finance.expenses.approval':      ['—', '—', '/api/expenses/toggle-selection + /api/expenses/generate-invoices-pdf (sélection→facture agrégée)'],
  'finance.expenses.ocr':           ['/api/ocr-extract + /api/ocr-imports (reconnaissance produits depuis tickets)', '—', '—'],

  'finance.receivables.aging':      ['—', '—', '/api/dashboard/total-creances + /api/dashboard/creances-mois (sans aging buckets)'],
  'finance.receivables.reminders':  ['—', '—', '—'],
  'finance.receivables.portfolio':  ['—', '—', '/api/creance/:accountId (CRUD + ops credit/advance/debit, perms par directeur)'],
  'finance.payables.aging':         ['—', '—', '—'],

  'finance.invoicing.invoices':     ['—', '—', 'Partiel : factures dépenses agrégées via /api/expenses/generate-invoices-pdf'],
  'finance.invoicing.tickets':      ['/api/print-direct (ESC/POS direct, pas PDF)', '—', '—'],
  'finance.invoicing.credit_notes': ['—', '—', '—'],
  'finance.invoicing.pdf':          ['—', '—', '/api/expenses/generate-invoices-pdf + /api/partner/generate-invoice-pdf-direct'],

  'finance.banking.accounts':       ['—', '—', 'routes accounts/* + add_account_types.sql + TYPES_COMPTES_GUIDE.md (5 types : classique, créance, fournisseur, partenaire, statut)'],
  'finance.banking.reconciliation': ['—', '—', '/api/audit/consistency/* + /api/admin/force-sync-account/:id (auto-detect/fix incohérences)'],
  'finance.banking.transfers':      ['—', '—', '/api/transfert + /api/transfers/account/:id (compte statut exclu, special interdit)'],

  'finance.payments.mobile_money':  ['/api/cash-payments/* + /api/payment-ref-mapping + /api/payment-links/* (Bictorys multi-opérateurs DÉJÀ INTÉGRÉ : Wave/OM/MTN)', '—', '/api/cash-bictorys/:monthYear (vue mensuelle agrégée + trigger PG sync compte statut)'],
  'finance.payments.cards':         ['—', '—', '—'],
  'finance.payments.cash':          ['Encaissement cash via /api/ventes (paiement type "espèces")', 'Encaissement par livreur', 'Catégorie compte classique'],

  'finance.partners.accounts':      ['—', '—', '/api/partner/* + GUIDE_COMPTES_PARTENAIRES (max 2 directeurs/compte, perms hiérarchiques)'],
  'finance.partners.deliveries':    ['—', '—', '/api/partner/:accountId/deliveries (workflow create→first-validate→final-validate→reject)'],

  // ─── Analytics ─────────────────────────────────────────────────
  'analytics.dashboards.sales':     ['/api/external/analytics + ANALYTICS_V1_DOCUMENTATION.md (logique GLOBAL vs SPÉCIFIQUE PV)', 'routes/analytics.js (12 endpoints : LTV, retention, churn, top, frequent)', '—'],
  'analytics.dashboards.inventory': ['/api/external/analytics + /api/external/stock-soir-marge', '—', '/api/visualisation/{stock-vivant,stock-pv,solde}-data'],
  'analytics.dashboards.finance':   ['—', '—', '/api/dashboard/stats-cards + NOUVELLES_CARTES_DASHBOARD.md (multi-cartes paramétrables)'],
  'analytics.dashboards.custom':    ['—', 'Tableau MATA mensuel + commentaires éditables in-place', '—'],

  'analytics.reports.standard':     ['—', '—', '—'],
  'analytics.reports.scheduled':    ['n8n externe (MATA BANQ REPORT 23h55)', 'n8n externe (MLC N8N GMAIL V2 4h30)', 'n8n externe (MATA BANQ REPORT)'],
  'analytics.reports.daily_digest': ['n8n MATA BANQ REPORT (Schedule 23h55 → /external/api/status → email)', 'n8n MLC N8N GMAIL V2 (Schedule 4h30 → livreurStats + orders → email 4 destinataires)', 'n8n MATA BANQ REPORT (status financier → email doucoure.saliou + ousmane.info)'],
  'analytics.reports.builder':      ['—', '—', '—'],

  'analytics.ai.insights':          ['—', 'deepAnalysisController + externalMataAuditController (sentiment OpenAI cache 6h)', '/api/ai-analysis + AI_ANALYSIS_README.md (GPT-4 sur dépenses)'],
  'analytics.ai.forecasting':       ['—', '—', '—'],
  'analytics.ai.agent':             ['Source de 7 endpoints aggregés via n8n MATA AGENT WEBHOOK (reconciliation×3, achats-boeuf, estimation, analytics, performance-achat, gestionStock, mtd)', 'Source 1 endpoint via n8n MATA AGENT (livreurStats)', 'Source 3 endpoints via n8n MATA AGENT (creance, status, virement) — webhook /webhook/mata-rapport-today agrège 16 APIs'],
  'analytics.market_intelligence':  ['/api/veille-betail + VEILLE_BETAIL_DOCUMENTATION.md (RSS Mali/Mauritanie + GPT-4o-mini, cache 12h, 5 keywords/25 articles)', '—', '—'],

  'analytics.exports.excel':        ['Exports Excel ad-hoc', 'OrderController.exportToExcel + exportLivreurDetailsToExcel + exportMataMonthlyToExcel', '—'],
  'analytics.exports.csv':          ['/api/import-ventes (inverse — import Excel/CSV)', '—', '—'],
  'analytics.exports.pdf':          ['—', '—', '/api/expenses/generate-invoices-pdf + /api/partner/generate-invoice-pdf-direct'],
};

// Modules par plan (extrait de db/migrations/0008_licensing.sql)
const PLAN_FREE = [
  'platform.identity', 'platform.team', 'platform.settings', 'platform.notifications', 'platform.files', 'platform.audit', 'platform.snapshots',
  'commercial.crm.customers', 'commercial.sales.pos',
  'operations.inventory.levels', 'operations.inventory.movements',
];
const PLAN_STARTER = [
  'platform.identity', 'platform.team', 'platform.settings', 'platform.notifications', 'platform.files', 'platform.audit', 'platform.snapshots',
  'commercial.crm.customers', 'commercial.crm.tags', 'commercial.crm.credits',
  'commercial.sales.pos', 'commercial.sales.cash_closure', 'commercial.sales.reconciliation', 'commercial.sales.discounts',
  'commercial.pricing.lists', 'commercial.pricing.history',
  'operations.inventory.levels', 'operations.inventory.movements', 'operations.inventory.transfers', 'operations.inventory.alerts', 'operations.inventory.counts', 'operations.inventory.unit_conversion',
  'finance.invoicing.tickets',
  'finance.payments.mobile_money', 'finance.payments.cash',
  'analytics.dashboards.sales', 'analytics.dashboards.inventory',
  'analytics.exports.csv', 'analytics.exports.excel',
];
const PLAN_PRO = [
  'platform.identity', 'platform.team', 'platform.settings', 'platform.notifications', 'platform.files', 'platform.audit', 'platform.snapshots', 'platform.api_keys', 'platform.webhooks',
  'commercial.crm.customers', 'commercial.crm.segments', 'commercial.crm.tags', 'commercial.crm.credits', 'commercial.crm.communications',
  'commercial.sales.pos', 'commercial.sales.cash_closure', 'commercial.sales.reconciliation', 'commercial.sales.performance_audit', 'commercial.sales.discounts', 'commercial.sales.loyalty',
  'commercial.subscriptions.plans', 'commercial.subscriptions.billing',
  'commercial.pricing.lists', 'commercial.pricing.history', 'commercial.pricing.promotions',
  'operations.inventory.levels', 'operations.inventory.movements', 'operations.inventory.transfers', 'operations.inventory.valuation', 'operations.inventory.alerts', 'operations.inventory.counts', 'operations.inventory.livestock',
  'operations.procurement.purchase_orders', 'operations.procurement.suppliers', 'operations.procurement.receiving', 'operations.procurement.slaughter',
  'operations.delivery.orders', 'operations.delivery.drivers', 'operations.delivery.gps', 'operations.delivery.routes', 'operations.delivery.scoring', 'operations.delivery.proof_of_delivery', 'operations.delivery.bidirectional_ratings',
  'operations.hr.timesheets', 'operations.hr.expenses', 'operations.hr.schedules',
  'finance.accounting.gl', 'finance.accounting.statements', 'finance.accounting.tax',
  'finance.expenses.entry', 'finance.expenses.approval', 'finance.expenses.ocr',
  'finance.receivables.aging', 'finance.receivables.reminders', 'finance.receivables.portfolio',
  'finance.payables.aging',
  'finance.invoicing.invoices', 'finance.invoicing.tickets', 'finance.invoicing.credit_notes', 'finance.invoicing.pdf',
  'finance.banking.accounts', 'finance.banking.reconciliation', 'finance.banking.transfers',
  'finance.payments.mobile_money', 'finance.payments.cards', 'finance.payments.cash',
  'finance.partners.accounts', 'finance.partners.deliveries',
  'analytics.dashboards.sales', 'analytics.dashboards.inventory', 'analytics.dashboards.finance',
  'analytics.reports.standard', 'analytics.reports.scheduled', 'analytics.reports.daily_digest',
  'analytics.ai.insights', 'analytics.ai.agent', 'analytics.market_intelligence',
  'analytics.exports.csv', 'analytics.exports.excel', 'analytics.exports.pdf',
  'platform.integrations',
];

// ============================================================================
// HELPERS — paragraphes, tables, code blocks
// ============================================================================

function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 120 },
    ...(opts.heading ? { heading: opts.heading } : {}),
    ...(opts.alignment ? { alignment: opts.alignment } : {}),
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text })],
    spacing: { before: 360, after: 200 },
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text })],
    spacing: { before: 280, after: 160 },
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text })],
    spacing: { before: 200, after: 140 },
  });
}

function code(lines) {
  // Code block — monospace, light gray background
  return lines.map(line => new Paragraph({
    children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18 })],
    spacing: { after: 0 },
    shading: { fill: 'F5F5F5', type: ShadingType.CLEAR, color: 'auto' },
  }));
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function makeTable(headers, rows, columnWidths) {
  const totalWidth = columnWidths.reduce((a, b) => a + b, 0);
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      borders: BORDERS,
      width: { size: columnWidths[i], type: WidthType.DXA },
      shading: { fill: 'D5E8F0', type: ShadingType.CLEAR, color: 'auto' },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18 })] })],
    })),
  });
  const dataRows = rows.map(row => new TableRow({
    children: row.map((cell, i) => new TableCell({
      borders: BORDERS,
      width: { size: columnWidths[i], type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: String(cell), size: 18 })] })],
    })),
  }));
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths,
    rows: [headerRow, ...dataRows],
  });
}

// ============================================================================
// CONTENT — par section
// ============================================================================

function pageDeGarde() {
  return [
    new Paragraph({ spacing: { before: 2400 }, children: [new TextRun('')] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Matix', size: 96, bold: true, color: '1F4E79' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 360 },
      children: [new TextRun({ text: 'Architecture Modules & Licences', size: 44, bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: 'Référence complète + parallèle avec les 3 apps Mata legacy', size: 28, italics: true, color: '595959' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 1200 },
      children: [new TextRun({ text: 'Maas App  ·  MLC (Matix Livreur)  ·  Dépenses Management', size: 22, color: '808080' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2400 },
      children: [new TextRun({ text: 'Mai 2026  ·  Mata Group', size: 22, color: '595959' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Suite SaaS B2B modulaire multi-tenant — Phase 0/1', size: 18, color: '808080', italics: true })],
    }),
  ];
}

function tocSection() {
  return [
    h1('Table des matières'),
    new TableOfContents('Sommaire', { hyperlink: true, headingStyleRange: '1-3' }),
  ];
}

function intro() {
  return [
    h1('1. Introduction'),

    h2('1.1 Contexte'),
    p('Matix est une suite SaaS B2B modulaire multi-tenant qui unifie en une seule plateforme les fonctionnalités aujourd\'hui éclatées entre les 3 applications Mata existantes :'),
    p('  •  Maas App — Ventes, Stock, Réconciliation, Achats bœuf, Abonnements, Caisse'),
    p('  •  Matix Livreur (MLC) — CRM, Livraison, GPS, Pointages, Crédits clients, Scoring'),
    p('  •  Dépenses Management — Comptabilité, Créances, Snapshots, Stock vivant, Partenaires'),
    p('Chacune de ces apps a été conçue de manière monolithique pour un seul tenant Mata. Matix passe à une architecture multi-tenant à l\'échelle de plusieurs milliers de clients PME africaines.'),

    h2('1.2 Pourquoi cette architecture ?'),
    p('Une suite multi-tenant qui veut servir des centaines voire des milliers de PME doit répondre à 3 questions simultanément :'),
    p('  1.  Comment vendre des plans flexibles sans dupliquer le code par client ? (granularité commerciale)'),
    p('  2.  Comment activer/désactiver une fonctionnalité par client en quelques secondes ? (granularité technique)'),
    p('  3.  Comment garantir qu\'un utilisateur ne voit que les données autorisées par son organisation ? (sécurité)'),
    p('Matix répond avec un système à 4 niveaux orthogonaux : modules (catalogue technique) → plans (paniers commerciaux) → licences (matérialisation par tenant) → permissions (par rôle dans le tenant). Ce document explique chacun de ces niveaux en détail.'),

    h2('1.3 À qui s\'adresse ce document'),
    p('  •  Founders / direction commerciale : sections 2, 3, 5 (concepts + plans)'),
    p('  •  Développeurs : sections 4, 6, 7 (catalogue exhaustif + parallèle legacy + exemples)'),
    p('  •  Auditeurs / investisseurs : sections 2, 3, 6 (architecture + couverture vs legacy)'),
    p('  •  Nouveaux arrivants : intégralité, en commençant par les concepts (section 2)'),
  ];
}

function concepts() {
  return [
    h1('2. Concepts clés'),

    h2('2.1 Module'),
    p('Un module est une unité fonctionnelle commercialement licenciable. C\'est la plus petite unité que le commercial Matix peut pricer indépendamment.'),
    p('Chaque module est défini dans le fichier apps/api/src/modules/licensing/catalog.ts avec :'),
    ...code([
      'export type ModuleDefinition = {',
      '  code:           string;       // ex: "commercial.sales.pos"',
      '  pillar:         Pillar;        // ex: "commercial"',
      '  label:          { fr: string; en: string };',
      '  description_fr: string;        // pépites métier (formules, invariants)',
      '  actions:        ("read" | "write" | "delete")[];',
      '  status:         "active" | "beta" | "coming-soon";',
      '  depends_on?:    string[];      // dépendances d\'autres modules',
      '};',
    ]),
    p('Le catalogue actuel contient 88 modules répartis en 5 piliers (Marketplace est réservé Phase 4).'),

    h2('2.2 Pilier'),
    p('Un pilier regroupe les modules d\'un même domaine métier. Permet de vendre des verticales (ex : un cabinet comptable n\'achète que Finance).'),
    p('Les 6 piliers Matix :'),
    p('  •  Platform — socle technique (auth, équipe, paramètres, audit, fichiers)'),
    p('  •  Commercial — front-office (CRM, POS, pricing, abonnements)'),
    p('  •  Operations — back-office (stock, achats, livraison, RH)'),
    p('  •  Finance — comptabilité, paiements, banking, partenaires'),
    p('  •  Analytics — reporting, dashboards, IA, exports'),
    p('  •  Marketplace — Phase 4 (catalogue tiers, vendors, commissions)'),

    h2('2.3 Plan'),
    p('Un plan est un panier prédéfini de modules à un prix mensuel fixe. Les 4 plans Matix :'),
    makeTable(
      ['Plan', 'Prix XOF/mois', 'Modules', 'Cible'],
      [
        ['Free',       '0',           '11', 'Onboarding, découverte'],
        ['Starter',    '15 000',      '30', 'Petite boutique'],
        ['Pro',        '50 000',      '81', 'Suite complète, multi-PV'],
        ['Enterprise', 'sur devis',   'tous (88)', 'Chaînes, multi-sites, custom'],
      ],
      [1500, 2000, 1500, 4400],
    ),

    h2('2.4 License (par tenant)'),
    p('Une licence est l\'activation d\'un module pour un tenant donné. Stockée dans la table tenant_licenses :'),
    ...code([
      'CREATE TABLE tenant_licenses (',
      '  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,',
      '  module_code   TEXT NOT NULL,                                          -- ex: "commercial.sales.pos"',
      '  enabled       BOOLEAN NOT NULL DEFAULT TRUE,',
      '  source        TEXT NOT NULL CHECK (source IN (\'plan\',\'addon\',\'manual\')),',
      '  expires_at    TIMESTAMPTZ,                                            -- pour les add-ons trial / beta',
      '  PRIMARY KEY (tenant_id, module_code)',
      ');',
    ]),
    p('Trois sources possibles, qui composent ensemble :'),
    p('  •  source = "plan" — module inclus dans le plan choisi par le tenant'),
    p('  •  source = "addon" — option payante au-dessus du plan'),
    p('  •  source = "manual" — activation gracieuse par Matix (commercial, beta-test)'),

    h2('2.5 Permission (par rôle)'),
    p('Une permission est l\'autorisation pour un rôle d\'effectuer une action (read/write/delete) sur un module. Stockée dans role_permissions :'),
    ...code([
      'CREATE TABLE role_permissions (',
      '  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,',
      '  role         TEXT NOT NULL CHECK (role IN (\'owner\',\'admin\',\'superviseur\',\'member\',\'readonly\')),',
      '  module_code  TEXT NOT NULL,',
      '  actions      TEXT[] NOT NULL DEFAULT \'{}\',  -- subset of [read, write, delete]',
      '  PRIMARY KEY (tenant_id, role, module_code)',
      ');',
    ]),
    p('5 rôles hiérarchiques par défaut : owner (créateur, tout droit), admin (gestion équipe + paramètres), superviseur (encadrement PV), member (opérations courantes), readonly (lecture seule).'),

    h2('2.6 Orthogonalité licence ↔ permission'),
    p('Les deux axes (licence et permission) répondent à des questions différentes et sont indépendants :'),
    makeTable(
      ['', 'Licence', 'Permission'],
      [
        ['Question',          '« Le tenant a-t-il payé ? »',  '« L\'utilisateur a-t-il le droit ? »'],
        ['Niveau',            'Tenant',                        '(Tenant, Rôle)'],
        ['Axe',               'Commercial',                    'Organisationnel'],
        ['Code HTTP en échec','402 Payment Required',          '403 Forbidden'],
        ['Change quand',      'Plan upgrade, add-on',          'Réorg interne du tenant'],
      ],
      [2200, 3500, 3700],
    ),
    p('Cette orthogonalité permet de changer un plan sans toucher à l\'organisation, et inversement (cf. ADR-0006).'),
  ];
}

function architecture() {
  return [
    h1('3. Architecture de licensing'),

    h2('3.1 Hiérarchie des concepts'),
    p('Schéma global : du catalogue technique à la vérification au runtime.'),
    ...code([
      '┌────────────────────────────────────────────────────────────┐',
      '│           CATALOG (catalog.ts) — 84 modules                │',
      '│  platform.identity • commercial.sales.pos • ...            │',
      '└─────────────────────┬──────────────────────────────────────┘',
      '                      │ référencés par',
      '                      ▼',
      '┌────────────────────────────────────────────────────────────┐',
      '│           PLANS (table plans) — 4 paniers                  │',
      '│  Free: 11 │ Starter: 30 │ Pro: 78 │ Enterprise: tous (84)  │',
      '└─────────────────────┬──────────────────────────────────────┘',
      '                      │ matérialisés en',
      '                      ▼',
      '┌────────────────────────────────────────────────────────────┐',
      '│   TENANT_LICENSES — 1 ligne par (tenant, module)           │',
      '│   source = \'plan\' | \'addon\' | \'manual\' • expires_at        │',
      '└─────────────────────┬──────────────────────────────────────┘',
      '                      │ contrôlés par',
      '                      ▼',
      '┌────────────────────────────────────────────────────────────┐',
      '│   ROLE_PERMISSIONS — 1 ligne par (tenant, rôle, module)    │',
      '│   actions = [read, write, delete]                          │',
      '└─────────────────────┬──────────────────────────────────────┘',
      '                      │ vérifiés à chaque requête par',
      '                      ▼',
      '              ┌──────────────────┐',
      '              │  LicensingGuard  │',
      '              └─────────┬────────┘',
      '                        │',
      '              ┌─────────┴─────────┐',
      '              ▼                   ▼',
      '        License OK ?         Permission OK ?',
      '              │                   │',
      '              ▼                   ▼',
      '        Si NON: 402         Si NON: 403',
      '        Payment Required    Forbidden',
    ]),

    h2('3.2 Flow d\'une requête HTTP'),
    p('Cycle de vie complet d\'une requête POST /sales venant d\'un utilisateur authentifié.'),
    ...code([
      'HTTP Request (POST /sales)',
      '  │  Authorization: Bearer eyJ...',
      '  ▼',
      '[Middleware CLS] extractAuthContext',
      '  ├─ Vérifie signature JWT (clé publique Keycloak en cache)',
      '  ├─ Lookup tenant_members WHERE deactivated_at IS NULL',
      '  └─ cls.set("tenantId", "userId", "role")',
      '  │',
      '  ▼',
      '[Interceptor TenantTx]',
      '  ├─ pool.connect()                              // user matix_app',
      '  ├─ BEGIN',
      '  ├─ SET LOCAL app.tenant_id = \'<uuid>\'         // pose la GUC RLS',
      '  └─ cls.set("pgClient", client)',
      '  │',
      '  ▼',
      '[Guard LicensingGuard]                           // @RequiresModule("commercial.sales.pos","write")',
      '  ├─ tenant_licenses[tenant, "commercial.sales.pos"].enabled?',
      '  │   └─ NON → throw 402 Payment Required',
      '  ├─ role_permissions[tenant, role, module].actions.includes("write")?',
      '  │   └─ NON → throw 403 Forbidden',
      '  ▼',
      '[Service métier] SalesService.create()',
      '  ├─ INSERT INTO sales (tenant_id, ...) VALUES (...)',
      '  │      ↑ Postgres RLS WITH CHECK valide tenant_id',
      '  ├─ INSERT sale_items, sale_payments',
      '  └─ Décrément atomique stock (operations.inventory.movements)',
      '  │',
      '  ▼',
      '[Interceptor finalise]',
      '  ├─ COMMIT',
      '  └─ client.release()',
      '  │',
      '  ▼',
      'HTTP 201 Created',
    ]),

    h2('3.3 Ordre des checks'),
    p('Le LicensingGuard vérifie d\'abord la licence (HTTP 402), puis la permission (HTTP 403). Pourquoi cet ordre :'),
    p('  •  Si pas licencié, c\'est inutile de vérifier la permission. Le 402 est l\'info utile au tenant'),
    p('  •  Si licencié + permission KO, le 403 est l\'info pertinente à l\'utilisateur'),
    p('  •  Sécurité : on ne laisse pas fuiter l\'existence d\'un module non licencié (un attaquant ne peut pas distinguer "module pas dans mon plan" de "permission refusée")'),

    h2('3.4 Pourquoi cette architecture en 4 couches ?'),
    p('Chaque couche répond à une préoccupation différente, et elles sont indépendantes :'),
    makeTable(
      ['Couche', 'Préoccupation', 'Acteur', 'Fréquence change'],
      [
        ['Catalog',          'Quoi est techniquement possible ?',  'Dev équipe Matix',                'Évolutif (ajout modules)'],
        ['Plans',            'Quoi est commercialement vendu ?',    'Commercial Matix',                'Rare (1 fois par trimestre)'],
        ['Tenant licenses',  'Quoi a payé ce tenant ?',             'Commercial Matix par tenant',     'Selon les ventes'],
        ['Role permissions', 'Quoi peut faire chaque utilisateur ?','Owner du tenant',                  'Selon RH du tenant'],
      ],
      [2400, 2800, 2400, 1700],
    ),
  ];
}

// ----------------------------------------------------------------------------
// Section 4 — Catalogue exhaustif des 84 modules (par pilier)
// ----------------------------------------------------------------------------

function moduleTableForPillar(pillarName, modules) {
  // Tableau étendu : Code | Label | Status | Plans | Description | Maas | MLC | Dépenses
  // Mode landscape A4 : ~14600 DXA de contenu utile
  const rows = modules.map(([code, label, status, actions, desc]) => {
    // Plans abrégés (F/S/P/E) pour gagner de la place
    const plans = (PLAN_FREE.includes(code) ? 'F' : '·')
                + (PLAN_STARTER.includes(code) ? 'S' : '·')
                + (PLAN_PRO.includes(code) ? 'P' : '·')
                + 'E'; // Enterprise = tous
    const legacy = LEGACY_MAP[code] || ['—', '—', '—'];
    return [code, label, status, plans, desc, legacy[0], legacy[1], legacy[2]];
  });
  return makeTable(
    ['Code', 'Label', 'Status', 'F/S/P/E', 'Description', 'Maas App', 'MLC', 'Dépenses Mgt'],
    rows,
    [1900, 1300, 850, 700, 2400, 2500, 2500, 2450],
  );
}

function catalogueComplet() {
  const elements = [
    h1('4. Catalogue exhaustif des modules'),
    p('88 modules répartis en 5 piliers actifs (Marketplace réservé Phase 4). Pour chaque module : code, label, status, plans incluant le module, description métier, et équivalent dans chacune des 3 apps Mata legacy (Maas App, MLC, Dépenses Management). Inclut 4 modules ajoutés en mai 2026 inspirés des workflows n8n existants : platform.integrations, platform.workflows, analytics.ai.agent, analytics.reports.daily_digest.'),
    p('Légende :'),
    p('  •  Status : active = livré · coming-soon = catalogué non-implémenté · beta = squelette en cours'),
    p('  •  F/S/P/E (plans) : F=Free · S=Starter · P=Pro · E=Enterprise (toujours présent). Le caractère "·" signifie "pas dans ce plan"'),
    p('  •  Cellules legacy : "—" = pas d\'équivalent · "(nouveau)" = innovation Matix sans précédent · texte = nom court + route/file de référence'),
    p('Pour les pépites métier détaillées (formules, invariants, workflows), voir docs/business-rules-catalog.md.'),
  ];
  for (const [pillar, modules] of Object.entries(MODULES_BY_PILLAR)) {
    elements.push(h2(`4.${Object.keys(MODULES_BY_PILLAR).indexOf(pillar) + 1} ${pillar} (${modules.length} modules)`));
    if (modules.length === 0) {
      elements.push(p('Pilier réservé Phase 4 : marketplace de modules tiers, gestion vendors, commissions. Aucun module catalogué pour l\'instant.'));
    } else {
      const activeCount = modules.filter(m => m[2] === 'active').length;
      elements.push(p(`${modules.length} modules au total dont ${activeCount} en status active (livrés).`));
      elements.push(moduleTableForPillar(pillar, modules));
    }
  }
  return elements;
}

// ----------------------------------------------------------------------------
// Section 5 — Plans commerciaux détaillés
// ----------------------------------------------------------------------------

function plansSection() {
  const elements = [
    h1('5. Plans commerciaux détaillés'),
    p('Les 4 plans Matix sont définis dans db/migrations/0008_licensing.sql. Le contenu de chaque plan est stocké en TEXT[] (Postgres array) directement dans la table plans, ce qui permet une lecture en 1 SELECT et un update atomique.'),

    h2('5.1 Tableau comparatif'),
    makeTable(
      ['Caractéristique', 'Free', 'Starter', 'Pro', 'Enterprise'],
      [
        ['Prix XOF/mois',       '0',          '15 000',   '50 000',   'sur devis'],
        ['Modules inclus',      '11',         '30',       '78',       '84 (tous)'],
        ['Source en DB',        'TEXT[]',     'TEXT[]',   'TEXT[]',   '[] (runtime)'],
        ['Cible commerciale',   'Onboarding', 'Petite boutique', 'Multi-PV', 'Chaînes, custom'],
        ['Custom permissions',  'Non',        'Non',      'Non',      'Oui (override)'],
        ['SLA',                 'Best effort','Best effort','99%',     '99.9% + dédié'],
      ],
      [2200, 1700, 1700, 1700, 2060],
    ),

    h2('5.2 Plan Free (0 XOF/mois)'),
    p('Public visé : découverte de Matix, micro-entreprise individuelle.'),
    p('Modules inclus :'),
    ...moduleListForPlan(PLAN_FREE),

    h2('5.3 Plan Starter (15 000 XOF/mois)'),
    p('Public visé : petite boutique avec 1-3 employés. Inclut tout le nécessaire pour vendre, gérer son stock simple, et faire ses tickets et exports basiques.'),
    p('Différences clés vs Free :'),
    p('  •  + tags clients (STANDARD/VIP/VVIP) et crédits clients'),
    p('  •  + clôture de caisse + réconciliation ventes (Pération abattage Maas)'),
    p('  •  + remises/discounts'),
    p('  •  + tarifs par PV + historique prix'),
    p('  •  + transferts inter-PV + alertes seuils + inventaires physiques + conversion unité↔kg'),
    p('  •  + tickets de caisse + paiements Mobile Money (Bictorys) + cash'),
    p('  •  + dashboards ventes/inventaire + exports CSV/Excel'),
    p('Modules inclus :'),
    ...moduleListForPlan(PLAN_STARTER),

    h2('5.4 Plan Pro (50 000 XOF/mois)'),
    p('Public visé : entreprise structurée avec plusieurs PV, équipe encadrée, ambition reporting et automatisation. Inclut quasiment tout sauf les modules Phase 4.'),
    p('Différences clés vs Starter :'),
    p('  •  + API keys + webhooks (intégrations externes)'),
    p('  •  + segments + communications + audit performance achats + loyalty'),
    p('  •  + abonnements (cartes MLC + mensuels Maas) + pricing.promotions'),
    p('  •  + valorisation stock + livestock + procurement complet (BdC, fournisseurs, abattage)'),
    p('  •  + delivery complet (orders, drivers, GPS, scoring, POD, ratings)'),
    p('  •  + HR (timesheets, expenses, schedules)'),
    p('  •  + comptabilité SYSCOHADA + invoicing complet + banking + partners'),
    p('  •  + cards + AI insights + market intelligence + reports planifiés'),
    p('Modules inclus :'),
    ...moduleListForPlan(PLAN_PRO),

    h2('5.5 Plan Enterprise (sur devis)'),
    p('Public visé : chaînes multi-sites, gros volumes, besoin de personnalisations.'),
    p('Particularités techniques :'),
    p('  •  En base, plans.modules = ARRAY[]::TEXT[] vide. Le code applicatif lit le catalogue MODULE_CATALOG au runtime et synthétise dynamiquement les licences Enterprise pour TOUS les modules disponibles. Cela évite de re-migrer le plan à chaque ajout de module au catalogue.'),
    p('  •  Permissions custom : un client Enterprise peut créer des rôles tenant-spécifiques avec des permissions override (Phase 2).'),
    p('  •  SLA dédié 99.9% + support prioritaire.'),
    p('  •  Possibilité de déploiement isolé (Phase 4) — base Postgres dédiée pour les très gros tenants.'),

    h2('5.6 Add-ons et activations manuelles'),
    p('Au-dessus du plan choisi, un tenant peut activer des modules supplémentaires via deux mécanismes :'),
    p('  •  Add-on (source = "addon") — option payante : un tenant Starter peut acheter sales.reconciliation seul à 5 000 XOF/mois sans passer Pro. Permet de pricer à la fonctionnalité.'),
    p('  •  Manual (source = "manual") — activation gracieuse : Matix offre un module gratuitement (geste commercial, beta-test, dépannage). expires_at posé pour limiter dans le temps.'),
    p('Voir Section 7 (Exemples concrets) pour des scénarios détaillés.'),
  ];
  return elements;
}

function moduleListForPlan(modules) {
  const grouped = {};
  for (const mod of modules) {
    const pillar = mod.split('.')[0];
    if (!grouped[pillar]) grouped[pillar] = [];
    grouped[pillar].push(mod);
  }
  const lines = [];
  for (const [pillar, mods] of Object.entries(grouped)) {
    lines.push(`${pillar.toUpperCase()} (${mods.length})`);
    for (const m of mods) lines.push(`  • ${m}`);
    lines.push('');
  }
  return code(lines);
}

// ----------------------------------------------------------------------------
// Section 6 — Parallèle avec apps Mata legacy
// ----------------------------------------------------------------------------

function paralleleLegacy() {
  return [
    h1('6. Parallèle avec les 3 apps Mata legacy'),
    p('Cette section synthétise l\'audit complet (cf. docs/feature-coverage-vs-mata-apps.md). Pour chaque app Mata, on identifie les fonctionnalités majeures et leur correspondance dans le catalogue Matix.'),
    p('Au total : 94 fonctionnalités auditées dans les 3 apps + 3 workflows n8n externes, mappés sur les 88 modules Matix. 10 gaps identifiés initialement (G1-G10) + 4 modules issus des workflows n8n récemment ajoutés au catalogue (platform.integrations, platform.workflows, analytics.ai.agent, analytics.reports.daily_digest).'),

    h2('6.1 Maas App (34 fonctionnalités)'),
    p('Application historique de gestion des ventes Mata. Stack : Node/Express + Postgres/Sequelize, schema-per-tenant, ~16k lignes server.js + 9 routers.'),
    p('Couverture Matix : ~32/34 fonctionnalités déjà cataloguées, 2 gaps (pré-commandes et traçabilité viande).'),
    h3('Fonctionnalités clés mappées'),
    makeTable(
      ['Fonctionnalité Maas', 'Module Matix', 'Statut'],
      [
        ['POS / Caisse',                            'commercial.sales.pos',                    '✓ Livré'],
        ['Stock matin/soir + transferts',           'operations.inventory.{levels,movements,transfers}','✓ Levels/Movements livrés'],
        ['Réconciliation (formule Pération)',       'commercial.sales.reconciliation',         'Catalogué'],
        ['Achats bœuf + audit performance',         'operations.procurement.slaughter + commercial.sales.performance_audit','Catalogué'],
        ['Estimations + WeightParams historisé',    'operations.inventory.unit_conversion',    'Catalogué'],
        ['Abonnements clients (mensuels)',          'commercial.subscriptions.plans',          'Catalogué'],
        ['Cash Bictorys (multi-opérateurs)',        'finance.payments.mobile_money',           'Catalogué'],
        ['OCR factures',                            'finance.expenses.ocr',                    'Catalogué'],
        ['Veille bétail (RSS + GPT)',               'analytics.market_intelligence',           'Catalogué'],
        ['Audit logs (qui/quoi/quand)',             'platform.audit',                          'Catalogué'],
        ['Restrictions temporelles NADOU/PAPI',     'platform.settings (edit_lock_hours)',     'Catalogué (gap mineur)'],
        ['Pré-commandes (workflow)',                'GAP — commercial.sales.preorders à créer','Gap'],
        ['Traçabilité viande lot→PV',               'GAP — operations.procurement.traceability','Gap'],
      ],
      [3500, 4000, 1860],
    ),

    h2('6.2 MLC — Matix Livreur (28 fonctionnalités)'),
    p('Application de gestion des livraisons et du CRM léger. Stack : Node/Express + Postgres + JWT, mono-tenant, 17 routers, modèles Order/User/Timesheet/GpsLocation/Subscription.'),
    p('Couverture Matix : ~25/28 fonctionnalités cataloguées, 3 gaps majeurs (versement cash livreur, salaires, tableau MATA mensuel).'),
    h3('Fonctionnalités clés mappées'),
    makeTable(
      ['Fonctionnalité MLC', 'Module Matix', 'Statut'],
      [
        ['Commandes livraison (CRUD + dashboard)',   'operations.delivery.orders',              'Catalogué'],
        ['GPS / géofencing zones Sénégal',           'operations.delivery.gps',                 'Catalogué'],
        ['Scoring livreurs (multi-dimensionnel)',    'operations.delivery.scoring',             'Catalogué'],
        ['Pointages (photos start/end + KM)',        'operations.hr.timesheets',                'Catalogué'],
        ['Dépenses livreur (carburant, etc.)',       'operations.hr.expenses',                  'Catalogué'],
        ['Subscriptions / Cartes livraison',         'commercial.subscriptions.plans',          'Catalogué (DUAL pattern Maas+MLC)'],
        ['Ratings bidirectionnels client↔livreur',   'operations.delivery.bidirectional_ratings','Catalogué'],
        ['Tags clients VIP/VVIP',                    'commercial.crm.tags',                     'Catalogué'],
        ['Crédits clients (optimistic locking)',     'commercial.crm.credits',                  'Catalogué'],
        ['Audit client + sentiment IA',              'commercial.crm.communications + analytics.ai.insights','Catalogué'],
        ['Pièces jointes commandes',                 'platform.files',                          'Catalogué'],
        ['Versement cash livreur → entreprise',      'GAP — operations.delivery.cash_remittance','Gap PRIORITAIRE'],
        ['Salaires livreurs',                        'GAP — operations.hr.payroll',             'Gap'],
        ['Tableau MATA mensuel + commentaires',      'option de analytics.dashboards.custom',   'Gap UX mineur'],
      ],
      [3500, 4000, 1860],
    ),

    h2('6.3 Dépenses Management (32 fonctionnalités)'),
    p('Application de comptabilité, créances, snapshots. Stack : Node/Express + Postgres, mono-tenant, monolithe ~17k lignes server.js. Compta single-entry à refondre en SYSCOHADA double-entry pour Matix.'),
    p('Couverture Matix : ~30/32 fonctionnalités cataloguées, 2 points à clarifier (workflow first/final-validate, type compte 5e).'),
    h3('Fonctionnalités clés mappées'),
    makeTable(
      ['Fonctionnalité Dépenses', 'Module Matix', 'Statut'],
      [
        ['Saisie dépenses + edit lock 48h',          'finance.expenses.entry',                  'Catalogué'],
        ['Approval workflow + génération PDF',       'finance.expenses.approval + invoicing.pdf','Catalogué'],
        ['Comptes bancaires (4-5 types)',            'finance.banking.accounts',                'Catalogué (vérifier 4 vs 5)'],
        ['Comptes partenaires + 2 directeurs max',   'finance.partners.accounts',               'Catalogué'],
        ['Livraisons partenaires (workflow)',        'finance.partners.deliveries',             'Catalogué (clarifier first/final)'],
        ['Créances clients (portfolio)',             'finance.receivables.portfolio',           'Catalogué'],
        ['Stock vivant (décote 20%)',                'operations.inventory.livestock',          'Catalogué'],
        ['Snapshots quotidiens JSON',                'platform.snapshots',                      'Catalogué'],
        ['Cash Bictorys (vue mensuelle)',            'finance.payments.mobile_money',           'Catalogué'],
        ['Virements mensuels',                       'finance.banking.transfers',               'Catalogué'],
        ['AI Analysis dépenses (GPT-4)',             'analytics.ai.insights',                   'Catalogué'],
        ['P&L visualisation (chrome scraping)',      'finance.accounting.statements',           'Catalogué (refonte)'],
        ['Audit consistency (auto-fix soldes)',      'finance.banking.reconciliation',          'Gap mineur (étendre desc)'],
        ['Configuration catégories + financial',     'platform.settings',                       '✓ Livré'],
        ['Rôle "comptable" (read-only finance)',     'platform.team (rôle)',                    '✓ Livré'],
      ],
      [3500, 4000, 1860],
    ),

    h2('6.4 Synthèse — Gaps prioritaires à ajouter au catalogue'),
    p('Sur 94 fonctionnalités auditées, 10 gaps identifiés. Un seul vrai nouveau code module à créer (G3) ; les autres sont des extensions de modules existants ou des options config/UX.'),
    makeTable(
      ['#', 'Fonctionnalité', 'Source', 'Module Matix suggéré', 'Phase', 'Priorité'],
      [
        ['G1','Pré-commandes',                  'Maas',           'commercial.sales.preorders',                    '1','Haute'],
        ['G2','Traçabilité viande lot→PV',      'Maas',           'operations.procurement.traceability',           '3','Moyenne'],
        ['G3','Versement cash livreur',         'MLC + Maas',     'operations.delivery.cash_remittance (NEW)',     '2','Haute'],
        ['G4','Salaires / paie livreurs',       'MLC',            'operations.hr.payroll',                         '3','Moyenne'],
        ['G5','Verrou temporel paramétrable',   'Maas',           'platform.settings.edit_lock_hours (option)',    '1','Haute'],
        ['G6','Découpe + forwarding',           'Maas',           'sous-feature de procurement.slaughter',         '3','Moyenne'],
        ['G7','Realtime / SSE dashboards',      'Maas + MLC',     'option transverse analytics.dashboards.*',      '2','Moyenne'],
        ['G8','Audit consistency soldes',       'Dépenses',       'finance.banking.reconciliation (étendre)',      '3','Moyenne'],
        ['G9','Tableau MATA mensuel',           'MLC',            'option analytics.dashboards.custom',            '2','Faible'],
        ['G10','Workflow first/final-validate', 'Dépenses',       'finance.partners.deliveries (étendre)',         '3','Moyenne'],
      ],
      [600, 2400, 1500, 3000, 700, 1160],
    ),

    h2('6.5 Workflows n8n externes (en transition vers modules natifs)'),
    p('Au-delà des 3 apps Mata legacy, l\'écosystème actuel inclut 3 workflows n8n hébergés sur une instance externe. Ils orchestrent des appels HTTP entre les apps + envoient des rapports email. Leur fonctionnalité sera progressivement absorbée par les 4 nouveaux modules Matix (ajoutés au catalogue en mai 2026).'),
    p('Les JSON des workflows sont versionnés dans infra/n8n-workflows/ avec un README de référence.'),
    makeTable(
      ['Workflow n8n', 'Trigger', 'Sources HTTP', 'Cible Matix'],
      [
        ['MATA BANQ REPORT',           'Schedule 23h55 (inactif)',          '1 endpoint Dépenses (/external/api/status)',                                                                  'analytics.reports.daily_digest'],
        ['MLC N8N GMAIL V2',           'Schedule 4h30 (actif)',             '2 endpoints MLC (livreurStats + orders)',                                                                     'analytics.reports.daily_digest'],
        ['MATA AGENT WEBHOOK',         'Webhook GET /webhook/mata-rapport-today (actif)', '16 APIs : Matix×7, Dépenses×3, MLC×1, Bictorys×2, PoS-CRM×1 + 2 reconciliation supplémentaires', 'analytics.ai.agent + analytics.reports.daily_digest'],
      ],
      [3000, 3000, 5500, 3500],
    ),
    p('Le workflow MATA AGENT WEBHOOK est particulièrement instructif : il préfigure analytics.ai.agent (un endpoint qui agrège l\'état business complet à la demande). Sa version Matix native ajoutera un LLM par-dessus pour permettre des questions en langage naturel ("CA aujourd\'hui ?", "meilleur livreur cette semaine ?").'),

    h2('6.6 Modules Matix nouveaux (sans équivalent legacy)'),
    p('30 modules du catalogue Matix qui n\'existent dans aucune des 3 apps Mata existantes. Ce sont les vraies innovations post-unification.'),
    p('Catégories :'),
    p('  •  Plateforme SaaS (multi-tenant, licensing, API keys, webhooks, notifications) — 6 modules'),
    p('  •  CRM avancé (segments, loyalty, promotions) — 3 modules'),
    p('  •  Inventaire structuré (alerts, counts, valuation, transfers) — 4 modules'),
    p('  •  Procurement formalisé (BdC, suppliers, receiving) — 3 modules'),
    p('  •  Delivery avancé (routes, POD formel, schedules) — 3 modules'),
    p('  •  Comptabilité SYSCOHADA double-entry (gl, statements, tax) — 3 modules'),
    p('  •  Invoicing complet (B2B, credit_notes) — 2 modules'),
    p('  •  Analytics avancé (reports.scheduled, builder, forecasting) — 3 modules'),
    p('  •  Cards payments — 1 module'),
    p('  •  Payables aging — 1 module'),
  ];
}

// ----------------------------------------------------------------------------
// Section 7 — Exemples concrets
// ----------------------------------------------------------------------------

function exemples() {
  return [
    h1('7. Exemples concrets'),
    p('4 scénarios couvrant les opérations principales du système de licensing : onboarding d\'un nouveau tenant, ajout d\'un add-on, upgrade de plan, et le cas réel actuel de Mata Mbao.'),

    h2('7.1 Exemple 1 : Onboarding "Boulangerie Diop" en plan Starter'),
    p('Contexte : un commercial Matix vient de signer Boulangerie Diop, une boulangerie de Dakar. Le client a souscrit au plan Starter (15 000 XOF/mois). On doit créer le tenant, le owner, et activer les 30 modules du Starter.'),
    p('Séquence d\'opérations (~360 ms total) :'),
    ...code([
      '-- 1. Création du tenant (~10 ms)',
      'INSERT INTO tenants (slug, legal_name, country_code, currency, locale, plan_id)',
      'VALUES (',
      '  \'boulangerie-diop\',',
      '  \'Boulangerie Diop SARL\',',
      '  \'SN\', \'XOF\', \'fr\',',
      '  (SELECT id FROM plans WHERE code = \'starter\')',
      ');',
      '',
      '-- 2. Matérialisation des licences depuis le plan (~50 ms)',
      'INSERT INTO tenant_licenses (tenant_id, module_code, enabled, source)',
      'SELECT $tenant_id, unnest(p.modules), TRUE, \'plan\'',
      '  FROM plans p WHERE p.code = \'starter\';',
      '-- → 30 lignes insérées (Free 11 + Starter additions)',
      '',
      '-- 3. Permissions par défaut pour les 5 rôles (~100 ms)',
      '-- INSERT massif de role_permissions selon templates par rôle',
      '-- Ex: owner = toutes actions sur tous modules, member = read+write sur sales/inventory uniquement',
      '',
      '-- 4. Création du owner Keycloak via API admin (~200 ms)',
      'POST /admin/realms/matix/users',
      '{ "email": "owner@boulangerie-diop.sn",',
      '  "attributes": { "tenant_id": "<uuid>" } }',
      '',
      '-- 5. INSERT tenant_members liant l\'utilisateur Keycloak au tenant (rôle owner)',
      'INSERT INTO tenant_members (tenant_id, user_id, role, created_at)',
      'VALUES ($tenant_id, $kc_user_id, \'owner\', NOW());',
    ]),
    p('Résultat : Boulangerie Diop peut se logger sur https://app.matix.test/login avec son email et le password reset link reçu par mail. Il accède aux 30 modules du Starter immédiatement. Aucun redéploiement.'),

    h2('7.2 Exemple 2 : Ajout d\'un add-on (Mata Mbao + Réconciliation)'),
    p('Contexte : Mata Mbao est en plan Pro (donc a déjà sales.reconciliation par son plan). Mais imaginons un client Starter qui veut activer la réconciliation sans passer Pro. Tarif add-on : 5 000 XOF/mois.'),
    p('Voie API admin :'),
    ...code([
      'POST /admin/licensing/:tenant_id/modules',
      '{',
      '  "module_code": "commercial.sales.reconciliation",',
      '  "source": "addon",',
      '  "expires_at": null              // illimité tant que payé',
      '}',
    ]),
    p('Voie SQL directe (ops) :'),
    ...code([
      'INSERT INTO tenant_licenses (tenant_id, module_code, enabled, source, expires_at)',
      'VALUES (',
      '  \'mata-keur-massar-uuid\',',
      '  \'commercial.sales.reconciliation\',',
      '  TRUE, \'addon\', NULL',
      ')',
      'ON CONFLICT (tenant_id, module_code)',
      'DO UPDATE SET enabled = TRUE, source = \'addon\';',
    ]),
    p('Effet : à la prochaine requête utilisateur, le LicensingGuard re-query tenant_licenses et trouve la nouvelle licence. Le menu Réconciliation apparaît dans l\'UI. Aucun cache à invalider, aucune session à killer.'),
    p('Si add-on à durée limitée (beta-test 30 jours) : poser expires_at = NOW() + interval \'30 days\'. Le LicensingGuard filtre automatiquement les licences expirées.'),

    h2('7.3 Exemple 3 : Upgrade Starter → Pro'),
    p('Contexte : un client en Starter veut passer en Pro pour avoir la livraison + comptabilité. Le commercial Matix utilise l\'endpoint admin :'),
    ...code([
      'PATCH /admin/licensing/:tenant_id/plan',
      '{ "plan_code": "pro" }',
    ]),
    p('Sous le capot, en transaction :'),
    ...code([
      '-- 1. Update du plan_id du tenant',
      'UPDATE tenants SET plan_id = (SELECT id FROM plans WHERE code = \'pro\')',
      ' WHERE id = $tenant_id;',
      '',
      '-- 2. Upsert des licences pour tous les modules du nouveau plan',
      'INSERT INTO tenant_licenses (tenant_id, module_code, enabled, source)',
      'SELECT $tenant_id, unnest(p.modules), TRUE, \'plan\'',
      '  FROM plans p WHERE p.code = \'pro\'',
      'ON CONFLICT (tenant_id, module_code)',
      'DO UPDATE SET enabled = TRUE, source = \'plan\';',
      '-- → Les modules du Starter restent (idempotent), 48 nouveaux modules ajoutés (Pro - Starter)',
      '',
      '-- 3. Optionnel : si on veut désactiver les add-ons absorbés par le nouveau plan',
      'UPDATE tenant_licenses SET source = \'plan\', expires_at = NULL',
      ' WHERE tenant_id = $tenant_id AND source = \'addon\'',
      '   AND module_code = ANY(',
      '     (SELECT modules FROM plans WHERE code = \'pro\')',
      '   );',
    ]),
    p('Effet immédiat : l\'utilisateur voit instantanément les 48 nouveaux modules dans son menu (si autorisé par sa permission). Aucun redéploiement, aucun téléchargement, le tenant continue à utiliser l\'app sans interruption.'),
    p('Note importante : les permissions par rôle (role_permissions) ne changent PAS automatiquement. Si le tenant n\'avait pas configuré de permission "delivery" pour ses members, l\'upgrade Pro inclut bien le module commercial mais aucun member ne peut l\'utiliser tant que l\'admin n\'attribue pas la permission.'),

    h2('7.4 Exemple 4 : Cas réel — Mata Mbao en plan Pro (état actuel)'),
    p('Suite à la session de migration native→Docker, le tenant Mata Mbao a été configuré en plan Pro. État observable en base :'),
    ...code([
      '-- Plan assigné',
      'SELECT t.slug, p.code AS plan_code, p.monthly_price_xof',
      '  FROM tenants t JOIN plans p ON p.id = t.plan_id',
      ' WHERE t.slug IN (\'mata-mbao\', \'mata-keur-massar\');',
      '',
      '   slug              | plan_code | monthly_price_xof',
      '  -------------------+-----------+-------------------',
      '   mata-mbao         | pro       |             50000',
      '   mata-keur-massar  | pro       |             50000',
      '',
      '',
      '-- Licences actives par tenant',
      'SELECT t.slug, COUNT(*) FILTER (WHERE tl.enabled) AS modules_enabled',
      '  FROM tenants t LEFT JOIN tenant_licenses tl ON tl.tenant_id = t.id',
      ' WHERE t.slug IN (\'mata-mbao\', \'mata-keur-massar\')',
      ' GROUP BY t.slug;',
      '',
      '   slug              | modules_enabled',
      '  -------------------+-----------------',
      '   mata-mbao         |              78',
      '   mata-keur-massar  |              78',
    ]),
    p('Les 78 modules du plan Pro sont matérialisés dans tenant_licenses pour chaque tenant. Le LicensingGuard valide le module à chaque requête sans re-calculer depuis plans.modules.'),
    p('Côté données métier : 128 produits par tenant (Mata Mbao + Mata Keur Massar) après dédup, organisés en 7 catégories réparties en 2 familles (Boucherie : Bovin/Ovin/Caprin/Volaille/Poisson/Pack ; Épicerie : Autres). Login fonctionnel avec owner@mata-mbao.test / Maas2026! → POS opérationnel.'),
  ];
}

// ----------------------------------------------------------------------------
// Section 8 — Annexes
// ----------------------------------------------------------------------------

function annexes() {
  return [
    h1('8. Annexes'),

    h2('8.1 Glossaire'),
    makeTable(
      ['Terme', 'Définition'],
      [
        ['Module',         'Unité fonctionnelle commercialement licenciable. Plus petite unité que le commercial peut pricer.'],
        ['Pilier',         'Regroupement de modules par domaine métier (Platform, Commercial, Operations, Finance, Analytics, Marketplace).'],
        ['Catalogue',      'Liste centralisée des 84 modules dans apps/api/src/modules/licensing/catalog.ts (source de vérité).'],
        ['Plan',           'Panier prédéfini de modules avec prix mensuel (Free, Starter, Pro, Enterprise).'],
        ['Add-on',         'Module activé en option au-dessus du plan, payant séparément.'],
        ['Licence',        'Activation d\'un module pour un tenant (table tenant_licenses).'],
        ['Permission',     'Autorisation pour un rôle d\'effectuer une action (read/write/delete) sur un module.'],
        ['Rôle',           'Niveau hiérarchique dans un tenant (owner, admin, superviseur, member, readonly).'],
        ['LicensingGuard', 'Code NestJS qui intercepte chaque requête et vérifie licence + permission.'],
        ['RLS',            'Row Level Security Postgres — filtre automatique des lignes par tenant_id.'],
        ['GUC',            'Variable de session Postgres (current_setting). Ex: app.tenant_id.'],
        ['Tenant',         'Une entreprise cliente isolée (Mata Mbao, Boulangerie Diop, etc.).'],
      ],
      [1500, 7860],
    ),

    h2('8.2 Tables DB de référence'),
    ...code([
      '-- Catalogue source de vérité',
      'apps/api/src/modules/licensing/catalog.ts          (TS, 84 modules)',
      '',
      '-- Tables DB',
      'plans               (4 lignes : Free / Starter / Pro / Enterprise)',
      'tenant_licenses     (1 ligne par tenant × module activé)',
      'role_permissions    (1 ligne par tenant × rôle × module × action)',
      'tenants             (1 ligne par client, lien plan_id)',
      'tenant_members      (1 ligne par utilisateur dans un tenant + son rôle)',
      '',
      '-- Migrations',
      'db/migrations/0008_licensing.sql                   (création tables + seed plans)',
    ]),

    h2('8.3 Documentation associée'),
    p('  •  docs/architecture-explained.md — Auth + RLS expliqué accessiblement'),
    p('  •  docs/architecture-faq.md — 20 Q&R sur l\'architecture'),
    p('  •  docs/granularity-and-scalability.md — Granularité 50 modules + Docker rationale + scaling'),
    p('  •  docs/business-rules-catalog.md — Pépites métier des 3 apps Mata'),
    p('  •  docs/feature-coverage-vs-mata-apps.md — Audit comparatif détaillé (94 fonctionnalités)'),
    p('  •  docs/local-setup.md — Démarrage Docker + troubleshooting'),

    h2('8.4 ADRs (Architecture Decision Records)'),
    makeTable(
      ['ADR', 'Sujet'],
      [
        ['ADR-0001', 'Multi-tenancy avec Postgres RLS'],
        ['ADR-0002', 'Convention des modules NestJS'],
        ['ADR-0003', 'Auth via Keycloak (OIDC)'],
        ['ADR-0004', 'Pilier Commercial — domain model'],
        ['ADR-0005', 'Catalogue centralisé des modules'],
        ['ADR-0006', 'Licensing & permissions orthogonales'],
        ['ADR-0007', 'Audit profond du catalogue (post-Maas)'],
      ],
      [1500, 7860],
    ),

    h2('8.5 Statistiques du catalogue actuel'),
    makeTable(
      ['Indicateur', 'Valeur'],
      [
        ['Total modules',                  '88'],
        ['Modules en status active',       '9'],
        ['Modules en status coming-soon',  '79'],
        ['Modules en status beta',         '0'],
        ['Piliers peuplés',                '5 (Platform 13, Commercial 16, Operations 22, Finance 22, Analytics 15)'],
        ['Pilier réservé Phase 4',         'Marketplace (0 modules)'],
        ['Plans définis',                  '4 (Free, Starter, Pro, Enterprise)'],
        ['Modules dans Free',              '11'],
        ['Modules dans Starter',           '30'],
        ['Modules dans Pro',               '81 (78 + integrations + ai.agent + daily_digest)'],
        ['Modules dans Enterprise',        '88 (calculés au runtime)'],
        ['Tenants actifs (mai 2026)',      '5 (Acme, Beta, Demo Corp, Mata Mbao, Mata Keur Massar)'],
        ['Fonctionnalités legacy auditées','94 (Maas 34 + MLC 28 + Dépenses 32)'],
        ['Gaps identifiés vs catalogue',   '10 (dont 1 nouveau module à créer)'],
      ],
      [3500, 5860],
    ),
  ];
}

// ============================================================================
// ASSEMBLAGE
// ============================================================================

const allChildren = [
  ...pageDeGarde(),
  pageBreak(),
  ...tocSection(),
  pageBreak(),
  ...intro(),
  ...concepts(),
  pageBreak(),
  ...architecture(),
  pageBreak(),
  ...catalogueComplet(),
  pageBreak(),
  ...plansSection(),
  pageBreak(),
  ...paralleleLegacy(),
  pageBreak(),
  ...exemples(),
  pageBreak(),
  ...annexes(),
];

const doc = new Document({
  creator: 'Mata Group',
  title: 'Matix — Architecture Modules & Licences',
  description: 'Référence complète + parallèle apps Mata legacy',
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial', color: '1F4E79' },
        paragraph: { spacing: { before: 360, after: 240 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: '2E75B6' },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: '404040' },
        paragraph: { spacing: { before: 200, after: 140 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        // A4 landscape (passe portrait dims + orientation, docx-js swap en interne)
        size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE },
        margin: { top: 720, right: 720, bottom: 720, left: 720 }, // 0.5" tous côtés
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'Matix — Modules & Licences', size: 16, color: '808080' })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: 'Page ', size: 16, color: '808080' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '808080' }),
            new TextRun({ text: ' / ', size: 16, color: '808080' }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '808080' }),
          ],
        })],
      }),
    },
    children: allChildren,
  }],
});

const outputPath = path.resolve(process.env.OUTPUT_DOCX || 'docs/matix-licensing-and-modules.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outputPath, buf);
  const sizeKb = (buf.length / 1024).toFixed(1);
  console.log(`✓ Generated ${outputPath} (${sizeKb} KB)`);
}).catch(err => {
  console.error('✗ Failed to generate docx:', err);
  process.exit(1);
});
