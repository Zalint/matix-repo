/**
 * Applique db/seed.sql (données de dev — tenants ACME et BETA pour les tests).
 *
 * Usage : pnpm db:seed
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const SEED_FILE = resolve(__dirname, '../../../../db/seed.sql');

async function main() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'matix',
    user: process.env.POSTGRES_ADMIN_USER ?? 'matix_admin',
    password: process.env.POSTGRES_ADMIN_PASSWORD ?? 'matix_admin_dev',
  });

  const sql = readFileSync(SEED_FILE, 'utf8');
  await pool.query(sql);
  console.log('✓ Seed appliquée.');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
