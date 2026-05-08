# ADR-0005 — Catalogue des modules Matix

- **Statut** : Proposed
- **Date** : 2026-05-08

## Contexte

Matix vise à devenir une suite SaaS B2B modulaire. Pour piloter le licensing, les permissions, la facturation, la doc auto et la sidebar du frontend, il faut **une source unique de vérité** des modules — formalisée dans le code, pas en DB (les modules ne se créent pas dynamiquement, ils sont écrits par les développeurs).

## Décision

### Identifiant : `pillar.area.module`

Format : 3 segments minimum, `lower_snake_case`.
Ex : `commercial.sales.pos`, `finance.banking.reconciliation`.

5 piliers fixes : `platform`, `commercial`, `operations`, `finance`, `analytics`.
(Plus `marketplace` Phase 4.)

### Manifest dans `apps/api/src/modules/licensing/catalog.ts`

```ts
export const MODULE_CATALOG: ModuleDefinition[] = [
  {
    code: 'commercial.sales.pos',
    pillar: 'commercial',
    label: { fr: 'Caisse / POS', en: 'Point of Sale' },
    description_fr: 'Saisie des ventes, paiements, ticket de caisse',
    actions: ['read', 'write', 'delete'],
    status: 'active',  // 'active' | 'beta' | 'coming-soon'
    depends_on: ['operations.inventory.levels', 'commercial.crm.customers'],
  },
  // ... ~45 entrées
];
```

### Catalogue exhaustif (extrait — voir `catalog.ts` pour le fichier source)

**platform** — fondations : identity, team, audit, notifications, files, api_keys, webhooks, settings, billing, snapshots, tenants_admin

**commercial** :
- crm : customers, segments, tags, credits, communications
- sales : pos, cash_closure, **reconciliation**, discounts, loyalty
- subscriptions : plans, billing
- pricing : lists, history, promotions

**operations** :
- inventory : levels, movements, transfers, valuation, alerts, counts, livestock
- procurement : purchase_orders, suppliers, receiving, slaughter
- delivery : orders, drivers, gps, routes, scoring
- hr : timesheets, expenses, schedules

**finance** :
- accounting : gl, statements, tax (SYSCOHADA)
- expenses : entry, approval, ocr
- receivables : aging, reminders, portfolio
- payables : aging
- invoicing : invoices, tickets, credit_notes, pdf
- banking : accounts, **reconciliation** (rapprochement), transfers
- payments : mobile_money (Bictorys), cards, cash
- partners : accounts, deliveries

**analytics** :
- dashboards : sales, inventory, finance, custom
- reports : standard, scheduled, builder
- ai : insights, forecasting
- exports : excel, csv, pdf

### Conséquences

- Un dev ajoute un module = il ajoute une entrée dans `catalog.ts` (PR)
- Le code est référence ; les tables `plans` et `tenant_licenses` ne contiennent que des `module_code` qui DOIVENT exister dans le catalogue (vérifié au seed et au runtime)
- Le frontend récupère le catalogue via `GET /licensing/catalog` (i18n `label.fr` / `label.en`)
