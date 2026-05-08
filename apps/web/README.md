# @matix/web

Frontend Next.js 15 (App Router) + Tailwind + shadcn/ui — **placeholder Phase 0**.

À scaffolder en début de Phase 1 avec :
```bash
pnpm create next-app@latest apps/web --ts --app --tailwind --src-dir --import-alias "@/*"
```

Puis ajouter :
- `next-intl` pour i18n FR/EN
- `shadcn/ui` pour components
- Wrapper PWA (`next-pwa` ou manifest manuel)
- Client API typé (vers `@matix/api`)
- Auth Keycloak via `next-auth` ou `oidc-client-ts`
