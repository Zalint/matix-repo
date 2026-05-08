# ADR-0002 — Convention de structure d'un module

- **Statut** : Accepted (validée par module CRM Customers — voir migration `0003_customers_init.sql`)
- **Date** : 2026-05-08
- **Décideurs** : Saliou Doucouré, équipe technique Matix
- **Référence** : implémente concrètement les principes posés par [ADR-0001](0001-multi-tenancy-rls.md)

## Contexte

Matix vise 12 modules métier (4 piliers). Sans convention forte, chaque module va dériver dans un style différent et la dette s'accumule. Odoo, qui est le benchmark, doit sa modularité à une convention rigide identique sur 40 000 addons. On veut le même résultat.

Cette ADR définit la **convention de structure et de découplage** d'un module Matix. Tout nouveau module DOIT la respecter, sous peine d'être refusé en revue.

## Décisions

### 1. Un module = un dossier auto-contenu sous `apps/api/src/modules/<nom>/`

```
apps/api/src/modules/<nom>/
├── <nom>.module.ts          # NestModule — déclare controllers, services, exports
├── <nom>.controller.ts      # HTTP — DTOs, décorateurs route, AUCUNE logique métier
├── <nom>.service.ts         # Logique métier — utilise getTenantPgClient(cls)
├── dto/
│   ├── create-<entity>.dto.ts
│   └── update-<entity>.dto.ts
├── events/                  # (optionnel) événements métier émis par le module
│   └── <entity>-created.event.ts
└── __tests__/
    ├── <nom>.service.spec.ts          # tests unitaires service
    └── <nom>.isolation.e2e-spec.ts    # tests anti-fuite RLS — OBLIGATOIRES
```

### 2. Migrations SQL versionnées par module

Sous `db/migrations/`, format : `NNNN_<module>_<verb>.sql` (ex : `0005_customers_init.sql`, `0008_customers_add_segment.sql`).

Chaque migration métier DOIT contenir :
- `CREATE TABLE` avec `tenant_id UUID NOT NULL REFERENCES tenants(id)`
- Toute `UNIQUE` inclut `tenant_id`
- Tout index commence par `tenant_id`
- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`
- Une `CREATE POLICY` d'isolation

Le linter `scripts/check-rls-migrations.sh` bloque le CI si une migration métier oublie un de ces éléments.

### 3. Aucun import direct de service inter-module

Si le module **Sales** a besoin de lire des données du module **Customers**, il y a 3 options par ordre de préférence :

1. **Le module fournit une `Facade`** : un service exposé volontairement comme API publique du module (ex : `CustomersFacade.getById(id)`). Ce service est exporté par `<nom>.module.ts`. Tout le reste du module reste privé.
2. **Évènements** : le module Customers émet `CustomerCreatedEvent` ; Sales s'y abonne via `EventEmitter2` ou un broker (BullMQ pour async). Préféré quand le couplage est faible.
3. **Lecture DB directe via vue/query partagée** : à éviter — couple fortement le schéma.

❌ JAMAIS d'`import { CustomersService } from '../customers/customers.service'` depuis un autre module.

### 4. Une migration ne référence JAMAIS une table d'un autre module en `FOREIGN KEY` directe sans validation explicite

Les FK cross-module sont autorisées (ex : `sales.customer_id REFERENCES customers.id`) mais doivent :
- Être documentées dans le commit
- Inclure un trigger ou check applicatif vérifiant que `tenant_id` est cohérent (cf. ADR-0001 §10.6)

### 5. Scope du service métier

Le `<nom>.service.ts` :
- Utilise `getTenantPgClient(this.cls)` pour les requêtes scopées tenant
- N'écrit **JAMAIS** `WHERE tenant_id = ...` — c'est la RLS qui filtre
- N'utilise `ADMIN_PG_POOL` (BYPASSRLS) que pour des opérations explicitement cross-tenant, justifiées et auditées
- Les transactions multi-statements utilisent le client CLS courant — l'interceptor a déjà ouvert une `BEGIN`

### 6. Manifest du module

Chaque module a un export `MODULE_MANIFEST` dans son fichier `<nom>.module.ts` :

```ts
export const MODULE_MANIFEST = {
  name: 'customers',
  pillar: 'commercial',           // 'platform' | 'commercial' | 'operations' | 'finance'
  tables: ['customers', 'customer_segments'],
  emitsEvents: ['CustomerCreatedEvent'],
  publicFacade: 'CustomersFacade',
} as const;
```

Le manifest sert à :
- Générer la documentation auto (matrice des modules)
- Vérifier en CI que toutes les `tables` listées ont bien RLS active (cf. ADR-0001 §9 "test scanné en CI")
- Visualiser les dépendances inter-modules

### 7. Rôles & permissions par module

Chaque module définit ses propres rôles dans son manifest, mais utilise les rôles plateforme standards comme base : `owner`, `admin`, `member`, `readonly`.

Permissions granulaires (ex : "peut valider une livraison partenaire", inspiré de Dépenses Mgmt) → table `module_permissions(tenant_id, module, role, permission)` à concevoir en livrable séparé (Phase 1).

### 8. Tests obligatoires

| Test | Fichier | Rôle |
|---|---|---|
| Isolation RLS | `<nom>.isolation.e2e-spec.ts` | Bloquant en CI. Au minimum : list, getById, update, delete cross-tenant + 1 test DB-direct |
| Service unitaire | `<nom>.service.spec.ts` | Logique métier, mocks de DB |
| (optionnel) E2E happy path | `<nom>.e2e-spec.ts` | Scénario complet d'un cas d'usage |

Coverage cible : 80% sur les services, 60% global. Pas de seuil sur les controllers (généralement triviaux).

### 9. Naming SQL

| Élément | Convention | Exemple |
|---|---|---|
| Table | `snake_case` pluriel | `customers`, `delivery_orders` |
| Colonne | `snake_case` | `unit_price`, `created_at` |
| FK | `<table>_id` | `customer_id` |
| Index | `idx_<table>_<colonnes>` | `idx_customers_tenant` |
| Policy RLS | `tenant_isolation` | toujours ce nom |
| Contrainte unique | inline avec `UNIQUE` | `UNIQUE (tenant_id, code)` |
| Trigger | `trg_<table>_<action>` | `trg_customers_updated_at` |

### 10. Naming TypeScript

| Élément | Convention | Exemple |
|---|---|---|
| Fichier | `kebab-case` | `customers.service.ts` |
| Classe | `PascalCase` | `CustomersService`, `CreateCustomerDto` |
| Variable / fonction | `camelCase` | `getById`, `customerId` |
| Constante | `SCREAMING_SNAKE` | `APP_PG_POOL` |
| DTO | `<Verbe><Entity>Dto` | `CreateCustomerDto`, `UpdateCustomerDto` |
| Type DB row | `<Entity>` (singulier) | `type Customer = { ... }` |

### 11. Errors & exceptions

- 404 (`NotFoundException`) quand une ressource n'existe pas dans le contexte du tenant — **identique** à "elle existe pour un autre tenant" (ne pas révéler).
- 422 (`UnprocessableEntityException`) pour des erreurs métier (ex : "stock insuffisant").
- 400 (`BadRequestException`) pour des données invalides (auto via `class-validator`).
- 401 (`UnauthorizedException`) pour auth invalide / manquante.
- 403 (`ForbiddenException`) pour permission refusée.
- 409 (`ConflictException`) pour conflit (ex : SKU déjà existant).
- 5xx pour bugs serveur — jamais en réponse à du valid input.

### 12. Logs

- Logger structuré (pino, à intégrer en livrable séparé Phase 0).
- Format : 1 ligne JSON par event.
- Champs obligatoires : `tenant_id`, `user_id`, `module`, `action`, `request_id`.
- Niveaux : `error` (incidents), `warn` (anomalies non-bloquantes), `info` (events métier importants), `debug` (dev seulement).
- ❌ Jamais de PII en clair (téléphone, email, NINEA…) — masquer.

## Conséquences

**Positives**
- N'importe quel dev de l'équipe sait où chercher quoi.
- Un module peut être extrait en service indépendant en Phase 4 sans réécriture (frontières propres).
- Les tests anti-fuite sont systématiques.
- Le manifest permet la doc auto et le scan RLS en CI.

**Négatives**
- Discipline en revue de PR : tout nouveau module passe en checklist.
- Léger boilerplate (manifest, structure dossiers).

## Action items

1. Saliou : valide ou challenge.
2. Statut → `Accepted` une fois le 2e module livré conforme à cette convention (ce sera **CRM Customers**, livrable suivant).
3. Ajouter un template `apps/api/src/modules/_template/` qui sert de base au scaffolding (livrable Phase 0).
