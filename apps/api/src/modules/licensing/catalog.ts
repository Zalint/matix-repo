/**
 * Catalogue des modules Matix — source de vérité unique (ADR-0005).
 *
 * Toute table `tenant_licenses.module_code` ou `plans.modules[]` doit
 * référencer un code présent ici. Vérifié au runtime par LicensingService.
 */

export type ModuleAction = 'read' | 'write' | 'delete';
export type Pillar = 'platform' | 'commercial' | 'operations' | 'finance' | 'analytics' | 'marketplace';

export type ModuleDefinition = {
  code: string;
  pillar: Pillar;
  label: { fr: string; en: string };
  /** Description métier détaillée — règles, formules, invariants. Voir docs/business-rules-catalog.md pour les pépites. */
  description_fr?: string;
  actions: ModuleAction[];
  status: 'active' | 'beta' | 'coming-soon';
  depends_on?: string[];
};

export const MODULE_CATALOG: ModuleDefinition[] = [
  // ─── platform ──────────────────────────────────────────────────────────
  { code: 'platform.identity',         pillar: 'platform', label: { fr: 'Identité',                en: 'Identity' },             actions: ['read'],                  status: 'active' },
  { code: 'platform.team',             pillar: 'platform', label: { fr: 'Équipe',                  en: 'Team' },                 actions: ['read','write','delete'], status: 'active' },
  { code: 'platform.tenants_admin',    pillar: 'platform', label: { fr: 'Administration tenants',  en: 'Tenants admin' },        actions: ['read','write','delete'], status: 'active' },
  { code: 'platform.audit',            pillar: 'platform', label: { fr: 'Audit logs',              en: 'Audit logs' },           actions: ['read'],                  status: 'coming-soon' },
  { code: 'platform.notifications',    pillar: 'platform', label: { fr: 'Notifications',           en: 'Notifications' },        actions: ['read','write'],          status: 'coming-soon' },
  { code: 'platform.files',            pillar: 'platform', label: { fr: 'Fichiers',                en: 'Files' },                actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'platform.api_keys',         pillar: 'platform', label: { fr: 'Clés API',                en: 'API keys' },             actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'platform.webhooks',         pillar: 'platform', label: { fr: 'Webhooks',                en: 'Webhooks' },             actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'platform.settings',         pillar: 'platform', label: { fr: 'Paramètres tenant',       en: 'Tenant settings' },      actions: ['read','write'],          status: 'active' },
  { code: 'platform.billing',          pillar: 'platform', label: { fr: 'Facturation Matix',       en: 'Matix billing' },        actions: ['read'],                  status: 'coming-soon' },
  { code: 'platform.snapshots',        pillar: 'platform', label: { fr: 'Snapshots',               en: 'Snapshots' },            actions: ['read'],                  status: 'coming-soon' },

  // ─── commercial ────────────────────────────────────────────────────────
  { code: 'commercial.crm.customers',          pillar: 'commercial', label: { fr: 'Clients',                  en: 'Customers' },          actions: ['read','write','delete'], status: 'active' },
  { code: 'commercial.crm.segments',           pillar: 'commercial', label: { fr: 'Segments clients',         en: 'Customer segments' },  actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'commercial.crm.tags',               pillar: 'commercial', label: { fr: 'Tags clients',             en: 'Customer tags' },      actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'commercial.crm.credits',            pillar: 'commercial', label: { fr: 'Crédits clients',          en: 'Customer credits' },   actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'commercial.crm.communications',     pillar: 'commercial', label: { fr: 'Historique communications',en: 'Comm. history' },      actions: ['read','write'],          status: 'coming-soon' },

  { code: 'commercial.sales.pos',              pillar: 'commercial', label: { fr: 'Caisse / POS',             en: 'Point of sale' },      actions: ['read','write','delete'], status: 'active' },
  { code: 'commercial.sales.cash_closure',     pillar: 'commercial', label: { fr: 'Clôture de caisse',        en: 'Cash closure' },       actions: ['read','write'],          status: 'coming-soon' },
  { code: 'commercial.sales.reconciliation',   pillar: 'commercial', label: { fr: 'Réconciliation ventes',    en: 'Sales reconciliation' },actions: ['read','write'],          status: 'coming-soon', description_fr: 'Comparaison ventes théoriques (stock matin − stock soir + transferts) vs ventes saisies. Formule "Pération" spéciale pour PV abattage : (Ventes Théoriques / Stock Matin) × 100.' },
  { code: 'commercial.sales.performance_audit',pillar: 'commercial', label: { fr: 'Audit performance achats',  en: 'Procurement performance audit' }, actions: ['read','write','delete'], status: 'coming-soon', description_fr: 'Audit acheteurs : compare estimations vs poids réel ; pénalité 2× pour surestimation ; cohérence ±0.5kg vs Suivi Achat ; verrouillage 24h ; classement avec score pénalisé.' },
  { code: 'commercial.sales.discounts',        pillar: 'commercial', label: { fr: 'Remises et codes promo',   en: 'Discounts & promos' }, actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'commercial.sales.loyalty',          pillar: 'commercial', label: { fr: 'Cartes de fidélité',       en: 'Loyalty cards' },      actions: ['read','write','delete'], status: 'coming-soon' },

  { code: 'commercial.subscriptions.plans',    pillar: 'commercial', label: { fr: 'Plans d\'abonnement',      en: 'Subscription plans' }, actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'commercial.subscriptions.billing',  pillar: 'commercial', label: { fr: 'Facturation récurrente',   en: 'Recurring billing' },  actions: ['read','write'],          status: 'coming-soon' },

  { code: 'commercial.pricing.lists',          pillar: 'commercial', label: { fr: 'Tarifs par PV',            en: 'Price lists' },        actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'commercial.pricing.history',        pillar: 'commercial', label: { fr: 'Historique des prix',      en: 'Price history' },      actions: ['read'],                  status: 'coming-soon' },
  { code: 'commercial.pricing.promotions',     pillar: 'commercial', label: { fr: 'Prix promo',               en: 'Promo pricing' },      actions: ['read','write','delete'], status: 'coming-soon' },

  // ─── operations ────────────────────────────────────────────────────────
  { code: 'operations.inventory.levels',       pillar: 'operations', label: { fr: 'Stocks par PV',            en: 'Stock levels' },       actions: ['read','write'],          status: 'active' },
  { code: 'operations.inventory.movements',    pillar: 'operations', label: { fr: 'Mouvements de stock',      en: 'Stock movements' },    actions: ['read','write'],          status: 'active' },
  { code: 'operations.inventory.transfers',    pillar: 'operations', label: { fr: 'Transferts inter-PV',      en: 'Inter-POS transfers' },actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'operations.inventory.valuation',    pillar: 'operations', label: { fr: 'Valorisation stock',       en: 'Stock valuation' },    actions: ['read'],                  status: 'coming-soon' },
  { code: 'operations.inventory.alerts',       pillar: 'operations', label: { fr: 'Alertes seuils',           en: 'Stock alerts' },       actions: ['read','write'],          status: 'coming-soon' },
  { code: 'operations.inventory.counts',       pillar: 'operations', label: { fr: 'Inventaires physiques',    en: 'Physical counts' },    actions: ['read','write'],          status: 'coming-soon' },
  { code: 'operations.inventory.livestock',    pillar: 'operations', label: { fr: 'Stock vivant',             en: 'Livestock' },          actions: ['read','write','delete'], status: 'coming-soon', description_fr: 'Animaux vivants & aliments : décote 20% par défaut ; UNIQUE(date, catégorie, produit) — pas de doublons.' },
  { code: 'operations.inventory.unit_conversion', pillar: 'operations', label: { fr: 'Conversion unité ↔ kg',  en: 'Unit-to-weight conversion' }, actions: ['read','write'],          status: 'coming-soon', description_fr: 'Conversion unité→kg HISTORISÉE par date (ex: bœuf=150kg/unité). Si poids standard change rétroactivement, les estimations gardent l\'ancien paramètre. Indispensable secteurs viande/agro.' },

  { code: 'operations.procurement.purchase_orders', pillar: 'operations', label: { fr: 'Bons de commande',     en: 'Purchase orders' },    actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'operations.procurement.suppliers',       pillar: 'operations', label: { fr: 'Fournisseurs',          en: 'Suppliers' },          actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'operations.procurement.receiving',       pillar: 'operations', label: { fr: 'Réception marchandises',en: 'Goods receiving' },    actions: ['read','write'],          status: 'coming-soon' },
  { code: 'operations.procurement.slaughter',       pillar: 'operations', label: { fr: 'Achats bœuf / découpe',en: 'Livestock procurement' },actions: ['read','write','delete'], status: 'coming-soon' },

  { code: 'operations.delivery.orders',        pillar: 'operations', label: { fr: 'Commandes livraison',      en: 'Delivery orders' },    actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'operations.delivery.drivers',       pillar: 'operations', label: { fr: 'Livreurs',                 en: 'Drivers' },            actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'operations.delivery.gps',           pillar: 'operations', label: { fr: 'GPS / géofencing',         en: 'GPS / geofencing' },   actions: ['read','write'],          status: 'coming-soon' },
  { code: 'operations.delivery.routes',        pillar: 'operations', label: { fr: 'Tournées',                 en: 'Routes' },             actions: ['read','write'],          status: 'coming-soon' },
  { code: 'operations.delivery.scoring',       pillar: 'operations', label: { fr: 'Scoring livreurs',         en: 'Driver scoring' },     actions: ['read'],                  status: 'coming-soon', description_fr: 'Score multi-dimensionnel : (bénéfice × 0.0003) + (km × KM_WEIGHT) + (pointages × 0.5). Cumul quotidien.' },
  { code: 'operations.delivery.proof_of_delivery', pillar: 'operations', label: { fr: 'Preuve de livraison', en: 'Proof of delivery' }, actions: ['read','write'],            status: 'coming-soon', description_fr: 'Signature client + photo geo-taggée + timestamp à la livraison. Stockage sécurisé conforme.' },
  { code: 'operations.delivery.bidirectional_ratings', pillar: 'operations', label: { fr: 'Évaluations bidirectionnelles', en: 'Bidirectional ratings' }, actions: ['read','write'], status: 'coming-soon', description_fr: 'Livreur évalue client (risque, comportement, paiement) — symétrique des ratings clients (service/qualité/prix).' },

  { code: 'operations.hr.timesheets',          pillar: 'operations', label: { fr: 'Pointages',                en: 'Timesheets' },         actions: ['read','write'],          status: 'coming-soon' },
  { code: 'operations.hr.expenses',            pillar: 'operations', label: { fr: 'Dépenses agent',           en: 'Agent expenses' },     actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'operations.hr.schedules',           pillar: 'operations', label: { fr: 'Planning',                 en: 'Schedules' },          actions: ['read','write'],          status: 'coming-soon' },

  // ─── finance ───────────────────────────────────────────────────────────
  { code: 'finance.accounting.gl',             pillar: 'finance', label: { fr: 'Plan comptable & journaux',  en: 'Chart of accounts' },     actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'finance.accounting.statements',     pillar: 'finance', label: { fr: 'États financiers',           en: 'Financial statements' },  actions: ['read'],                  status: 'coming-soon' },
  { code: 'finance.accounting.tax',            pillar: 'finance', label: { fr: 'Déclarations TVA',           en: 'VAT declarations' },      actions: ['read','write'],          status: 'coming-soon' },

  { code: 'finance.expenses.entry',            pillar: 'finance', label: { fr: 'Saisie dépenses',            en: 'Expense entry' },         actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'finance.expenses.approval',         pillar: 'finance', label: { fr: 'Validation dépenses',        en: 'Expense approval' },      actions: ['read','write'],          status: 'coming-soon' },
  { code: 'finance.expenses.ocr',              pillar: 'finance', label: { fr: 'OCR justificatifs',          en: 'Receipt OCR' },           actions: ['read','write'],          status: 'coming-soon' },

  { code: 'finance.receivables.aging',         pillar: 'finance', label: { fr: 'État âgé créances',          en: 'AR aging' },              actions: ['read'],                  status: 'coming-soon' },
  { code: 'finance.receivables.reminders',     pillar: 'finance', label: { fr: 'Relances',                   en: 'Reminders' },             actions: ['read','write'],          status: 'coming-soon' },
  { code: 'finance.receivables.portfolio',     pillar: 'finance', label: { fr: 'Portfolio créances',         en: 'AR portfolio' },          actions: ['read','write'],          status: 'coming-soon' },

  { code: 'finance.payables.aging',            pillar: 'finance', label: { fr: 'État âgé fournisseurs',      en: 'AP aging' },              actions: ['read'],                  status: 'coming-soon' },

  { code: 'finance.invoicing.invoices',        pillar: 'finance', label: { fr: 'Factures B2B',               en: 'B2B invoices' },          actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'finance.invoicing.tickets',         pillar: 'finance', label: { fr: 'Tickets de caisse',          en: 'Cash tickets' },          actions: ['read','write'],          status: 'coming-soon' },
  { code: 'finance.invoicing.credit_notes',    pillar: 'finance', label: { fr: 'Avoirs',                     en: 'Credit notes' },          actions: ['read','write'],          status: 'coming-soon' },
  { code: 'finance.invoicing.pdf',             pillar: 'finance', label: { fr: 'Génération PDF',             en: 'PDF rendering' },         actions: ['read'],                  status: 'coming-soon' },

  { code: 'finance.banking.accounts',          pillar: 'finance', label: { fr: 'Comptes bancaires',          en: 'Bank accounts' },         actions: ['read','write','delete'], status: 'coming-soon', description_fr: '4 types — classique (solde = crédité − dépensé), partenaire (décrémenté par livraisons validées), statut (lecture-seule, exclu transferts), ajustement/special (isolé du P&L).' },
  { code: 'finance.banking.reconciliation',    pillar: 'finance', label: { fr: 'Rapprochement bancaire',     en: 'Bank reconciliation' },   actions: ['read','write'],          status: 'coming-soon' },
  { code: 'finance.banking.transfers',         pillar: 'finance', label: { fr: 'Virements',                  en: 'Bank transfers' },        actions: ['read','write','delete'], status: 'coming-soon' },

  { code: 'finance.payments.mobile_money',     pillar: 'finance', label: { fr: 'Mobile Money (Bictorys)',    en: 'Mobile Money' },          actions: ['read','write'],          status: 'coming-soon' },
  { code: 'finance.payments.cards',            pillar: 'finance', label: { fr: 'Cartes bancaires',           en: 'Card payments' },         actions: ['read','write'],          status: 'coming-soon' },
  { code: 'finance.payments.cash',             pillar: 'finance', label: { fr: 'Espèces',                    en: 'Cash payments' },         actions: ['read','write'],          status: 'active' },

  { code: 'finance.partners.accounts',         pillar: 'finance', label: { fr: 'Comptes partenaires',        en: 'Partner accounts' },      actions: ['read','write','delete'], status: 'coming-soon' },
  { code: 'finance.partners.deliveries',       pillar: 'finance', label: { fr: 'Livraisons partenaires',     en: 'Partner deliveries' },    actions: ['read','write'],          status: 'coming-soon' },

  // ─── analytics ─────────────────────────────────────────────────────────
  { code: 'analytics.dashboards.sales',        pillar: 'analytics', label: { fr: 'Dashboard ventes',         en: 'Sales dashboard' },       actions: ['read'],                  status: 'coming-soon' },
  { code: 'analytics.dashboards.inventory',    pillar: 'analytics', label: { fr: 'Dashboard stock',          en: 'Inventory dashboard' },   actions: ['read'],                  status: 'coming-soon' },
  { code: 'analytics.dashboards.finance',      pillar: 'analytics', label: { fr: 'Dashboard finance',        en: 'Finance dashboard' },     actions: ['read'],                  status: 'coming-soon' },
  { code: 'analytics.dashboards.custom',       pillar: 'analytics', label: { fr: 'Dashboards personnalisés', en: 'Custom dashboards' },     actions: ['read','write','delete'], status: 'coming-soon' },

  { code: 'analytics.reports.standard',        pillar: 'analytics', label: { fr: 'Rapports standard',        en: 'Standard reports' },      actions: ['read'],                  status: 'coming-soon' },
  { code: 'analytics.reports.scheduled',       pillar: 'analytics', label: { fr: 'Rapports planifiés',       en: 'Scheduled reports' },     actions: ['read','write'],          status: 'coming-soon' },
  { code: 'analytics.reports.builder',         pillar: 'analytics', label: { fr: 'Constructeur de rapports', en: 'Report builder' },        actions: ['read','write','delete'], status: 'coming-soon' },

  { code: 'analytics.ai.insights',             pillar: 'analytics', label: { fr: 'Insights IA',              en: 'AI insights' },           actions: ['read'],                  status: 'coming-soon' },
  { code: 'analytics.ai.forecasting',          pillar: 'analytics', label: { fr: 'Prévisions IA',            en: 'AI forecasting' },        actions: ['read'],                  status: 'coming-soon' },
  { code: 'analytics.market_intelligence',     pillar: 'analytics', label: { fr: 'Veille marché',            en: 'Market intelligence' },   actions: ['read'],                  status: 'coming-soon', description_fr: 'RSS actualités fournisseurs (Mali/Mauritanie pour bétail) + OpenAI GPT alertes : fermetures frontières, sécheresse, variations prix régionaux, risques approvisionnement. Cache 12h.' },

  { code: 'analytics.exports.excel',           pillar: 'analytics', label: { fr: 'Export Excel',             en: 'Excel export' },          actions: ['read'],                  status: 'coming-soon' },
  { code: 'analytics.exports.csv',             pillar: 'analytics', label: { fr: 'Export CSV',               en: 'CSV export' },            actions: ['read'],                  status: 'coming-soon' },
  { code: 'analytics.exports.pdf',             pillar: 'analytics', label: { fr: 'Export PDF',               en: 'PDF export' },            actions: ['read'],                  status: 'coming-soon' },
];

export const MODULE_CODES = new Set(MODULE_CATALOG.map((m) => m.code));

export function isValidModuleCode(code: string): boolean {
  return MODULE_CODES.has(code);
}
