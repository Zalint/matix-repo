/**
 * Runner de migrations minimaliste.
 *
 * Lit les fichiers .sql dans `db/migrations/` (à la racine du repo), trie par nom,
 * et applique ceux qui ne sont pas encore enregistrés dans `_migrations`.
 *
 * Tourne sous le compte matix_admin (BYPASSRLS) pour pouvoir créer/modifier des tables.
 *
 * Usage : pnpm db:migrate
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';

const MIGRATIONS_DIR = resolve(__dirname, '../../../../db/migrations');

async function main() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'matix',
    user: process.env.POSTGRES_ADMIN_USER ?? 'matix_admin',
    password: process.env.POSTGRES_ADMIN_PASSWORD ?? 'matix_admin_dev',
  });

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await client.query<{ name: string }>(
        'SELECT name FROM _migrations WHERE name = $1',
        [file],
      );
      if (rows.length > 0) {
        console.log(`✓ ${file} (déjà appliquée)`);
        continue;
      }

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`→ Application de ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations(name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`✓ ${file} appliquée`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`✗ ${file} a échoué`);
        throw e;
      }
    }
    console.log('\nMigrations à jour.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
