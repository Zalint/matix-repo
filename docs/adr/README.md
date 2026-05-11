# Architecture Decision Records

Décisions structurelles de Matix. Format : [MADR-light](https://adr.github.io/madr/).

| # | Titre | Statut |
|---|---|---|
| [0001](0001-multi-tenancy-rls.md) | Multi-tenancy avec Postgres RLS | Proposed |
| [0002](0002-module-convention.md) | Convention de structure d'un module | Accepted |
| [0003](0003-auth-keycloak.md) | Auth & SSO avec Keycloak (dual-mode) | Proposed |
| [0004](0004-pilier-commercial-domain.md) | Schéma de domaine du Pilier Commercial (Sales/POS, Inventory, Invoicing, Payments) | Proposed |
| [0005](0005-module-catalog.md) | Catalogue des modules Matix | Proposed |
| [0006](0006-licensing-permissions.md) | Licensing & Permissions (orthogonal) | Proposed |
| [0007](0007-catalog-deepaudit-update.md) | Mise à jour catalogue après audit approfondi | Proposed |
| [0008](0008-stock-soir-modes.md) | Stock soir : deux modes (manuel/automatique) + cron carry-over | Proposed |
| [0009](0009-stock-cuttings.md) | Découpes : nouvelle primitive de mouvement + tarif gros à la vente | Proposed |
| [0010](0010-gros-rebate-default.md) | Rabais "vente en gros" par défaut au niveau tenant | Proposed |

## Convention

- Numérotation séquentielle, jamais réutilisée.
- Statuts : `Proposed` → `Accepted` → (éventuellement) `Superseded by ADR-XXXX`.
- Une ADR n'est **jamais modifiée** une fois `Accepted` ; on en crée une nouvelle qui la supersede.
