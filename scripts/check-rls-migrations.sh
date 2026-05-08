#!/usr/bin/env bash
#
# Lint custom : toute migration qui contient `CREATE TABLE` (hors tables système connues)
# DOIT inclure `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` et au moins une `CREATE POLICY`.
#
# Échoue le CI si une migration métier oublie un de ces éléments.
# Voir docs/adr/0001-multi-tenancy-rls.md.
#
set -euo pipefail

MIGRATIONS_DIR="db/migrations"
SYSTEM_MIGRATION_PREFIX="0001_"   # tables système : tenants, tenant_members, plans, etc.

failed=0

for file in "$MIGRATIONS_DIR"/*.sql; do
  base=$(basename "$file")

  # Skip migrations système connues
  if [[ "$base" == ${SYSTEM_MIGRATION_PREFIX}* ]]; then
    continue
  fi

  if grep -qiE 'CREATE\s+TABLE' "$file"; then
    if ! grep -qiE 'ENABLE\s+ROW\s+LEVEL\s+SECURITY' "$file"; then
      echo "✗ $base : ENABLE ROW LEVEL SECURITY manquant"
      failed=1
    fi
    if ! grep -qiE 'FORCE\s+ROW\s+LEVEL\s+SECURITY' "$file"; then
      echo "✗ $base : FORCE ROW LEVEL SECURITY manquant"
      failed=1
    fi
    if ! grep -qiE 'CREATE\s+POLICY' "$file"; then
      echo "✗ $base : aucune CREATE POLICY définie"
      failed=1
    fi
  fi
done

if [[ $failed -eq 0 ]]; then
  echo "✓ Toutes les migrations métier respectent le pattern RLS."
else
  echo
  echo "Voir docs/adr/0001-multi-tenancy-rls.md pour le pattern obligatoire."
  exit 1
fi
