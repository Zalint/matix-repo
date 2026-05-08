# ADR-0006 — Licensing & Permissions

- **Statut** : Proposed
- **Date** : 2026-05-08
- **Référence** : implémente l'orthogonalité licensing/permissions challengée par Saliou

## Contexte

Une suite modulaire facturée nécessite deux décisions distinctes pour chaque action :
1. **Le tenant a-t-il acheté ce module ?** → licensing
2. **L'utilisateur a-t-il le droit de faire cette action ?** → permissions

Confondre les deux = bugs et UX cauchemar.

## Décision

### Licensing : OUI/NON par module, par tenant

```sql
CREATE TABLE plans (
  id UUID PRIMARY KEY,
  code TEXT UNIQUE,                   -- 'free' | 'starter' | 'pro' | 'enterprise'
  name TEXT,
  monthly_price_xof BIGINT NOT NULL,
  modules TEXT[] NOT NULL,            -- liste des module_code inclus
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE tenant_licenses (
  tenant_id UUID,
  module_code TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL,               -- 'plan' | 'addon' | 'manual'
  expires_at TIMESTAMPTZ,             -- pour les essais limités
  PRIMARY KEY (tenant_id, module_code)
);

ALTER TABLE tenants ADD COLUMN plan_id UUID REFERENCES plans;
```

Quand un tenant souscrit un plan, on **matérialise** une ligne `tenant_licenses` pour chaque module du plan (`source='plan'`). Add-ons → `source='addon'`. Override manuel super-admin → `source='manual'`.

Lecture rapide : `SELECT module_code FROM tenant_licenses WHERE tenant_id=$1 AND enabled=TRUE`.

### Permissions : presets de rôles par défaut, surcharges custom uniquement Enterprise

**Defaults code-based** dans `apps/api/src/modules/licensing/role-defaults.ts` :

```ts
type Action = 'read' | 'write' | 'delete';
type RolePerms = Record<TenantRole, Record<string /* module */, Action[]>>;

export const ROLE_DEFAULTS_FALLBACK: Record<TenantRole, Action[]> = {
  owner:       ['read', 'write', 'delete'],
  admin:       ['read', 'write', 'delete'],   // sauf plateforme.* core (filtré dans le guard)
  superviseur: ['read', 'write'],
  member:      ['read', 'write'],              // limité à modules opérationnels (filtré)
  readonly:    ['read'],
};

// Restrictions ciblées par module :
export const ROLE_OVERRIDES: Partial<RolePerms> = {
  member: {
    'finance.accounting.gl':         ['read'],     // member peut consulter, pas écrire
    'finance.accounting.statements': ['read'],
    'platform.team':                 [],            // pas d'accès gestion équipe
    'platform.tenants_admin':        [],
    'analytics.reports.builder':     ['read'],
  },
  superviseur: {
    'platform.team':                 ['read'],
    'platform.tenants_admin':        [],
  },
  admin: {
    'platform.tenants_admin':        [],            // super-admin Matix only
  },
};
```

**Surcharges custom (Enterprise tier, Phase 2)** — table `role_permissions` :
```sql
CREATE TABLE role_permissions (
  tenant_id UUID,
  role TEXT,
  module_code TEXT,
  actions TEXT[] NOT NULL,            -- subset de ['read','write','delete']
  PRIMARY KEY (tenant_id, role, module_code)
);
```
Si une ligne existe pour `(tenant, role, module)` → elle override le default. Sinon → default.

### Guard NestJS

```ts
@RequiresModule('commercial.sales.pos', 'write')
@Post()
create(@Body() dto: CreateSaleDto) { ... }
```

Le guard `LicensingGuard` :
1. Lit `tenant_id` + `role` du CLS (déjà posé par extractAuthContext).
2. Vérifie `tenant_licenses.enabled = TRUE` pour ce module → sinon **402 Payment Required** (avec un message clair "Ce module n'est pas inclus dans votre plan").
3. Vérifie permissions : action ∈ `ROLE_OVERRIDES[role][module] ?? ROLE_DEFAULTS_FALLBACK[role]`. Sinon **403 Forbidden**.

L'ordre des checks compte : licence d'abord (commerce), puis rôle (sécu).

### Plans Phase 1

| Plan | Modules | Prix |
|---|---|---|
| **Free** | platform.*, crm.customers, sales.pos, inventory.levels/movements | 0 |
| **Starter** | + sales.cash_closure, sales.reconciliation, invoicing.tickets, dashboards.sales, payments.mobile_money | 15 000 XOF/mois |
| **Pro** | + accounting (SYSCOHADA), delivery.*, hr.*, expenses.*, dashboards.*, ai.insights, exports.* | 50 000 XOF/mois |
| **Enterprise** | tout + role_permissions custom + api_keys + webhooks + SLA | sur devis |

## Conséquences

- Un module désactivé renvoie 402 partout — l'UI peut afficher un upsell propre
- Les rôles restent simples (5 presets) → onboarding rapide
- Custom permissions disponibles pour les gros clients qui paient
- Endpoint `GET /licensing` → un user voit ses modules + permissions calculées (utile pour l'UI : cacher les boutons inaccessibles)

## Action items

1. Migration `0008_licensing.sql` (plans, tenant_licenses, alter tenants)
2. Catalog TS + role defaults
3. Module `licensing` backend (guard + service + endpoints publics + admin)
4. Refactor progressif des endpoints existants pour ajouter `@RequiresModule`
5. Frontend `/settings/licensing` (lecture pour tenant) + `/admin/tenants/:id/licensing` (super-admin)
