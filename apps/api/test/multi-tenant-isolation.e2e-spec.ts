/**
 * TESTS ANTI-FUITE MULTI-TENANT — bloquants en CI.
 *
 * Ces tests prouvent que la RLS Postgres isole bien les tenants entre eux,
 * tant au niveau API qu'au niveau base de données directe.
 *
 * Si un de ces tests casse, on a probablement une fuite cross-tenant en prod.
 * NE JAMAIS désactiver / skip un de ces tests sans audit + ADR justifiant.
 *
 * Pré-requis : `pnpm db:migrate && pnpm db:seed` exécutés (tenants ACME et BETA présents).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';

import { AppModule } from '../src/app.module';
import { ADMIN_PG_POOL } from '../src/common/database.module';

const TENANT_A = 'a1111111-1111-4111-8111-111111111111'; // acme
const USER_A = 'a1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'b2222222-2222-4222-8222-222222222222'; // beta
const USER_B = 'b2222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('Multi-tenant isolation (RLS)', () => {
  let app: INestApplication;
  let adminPool: Pool;

  beforeAll(async () => {
    process.env.DEV_AUTH_ENABLED = 'true';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    adminPool = app.get(ADMIN_PG_POOL);

    // Nettoyage des produits de test éventuels
    await adminPool.query(`DELETE FROM products WHERE sku LIKE 'TEST-%'`);
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM products WHERE sku LIKE 'TEST-%'`);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Niveau API
  // -------------------------------------------------------------------------

  it('API: tenant B ne voit JAMAIS les produits du tenant A', async () => {
    // A crée un produit "secret"
    await request(app.getHttpServer())
      .post('/products')
      .set('X-Dev-Tenant-Id', TENANT_A)
      .set('X-Dev-User-Id', USER_A)
      .send({ sku: 'TEST-SECRET-A', name: 'Produit secret A', unit_price: 9999 })
      .expect(201);

    // B liste ses produits — ne doit JAMAIS voir TEST-SECRET-A
    const res = await request(app.getHttpServer())
      .get('/products')
      .set('X-Dev-Tenant-Id', TENANT_B)
      .set('X-Dev-User-Id', USER_B)
      .expect(200);

    expect(res.body.find((p: { sku: string }) => p.sku === 'TEST-SECRET-A')).toBeUndefined();
  });

  it('API: tenant B ne peut PAS lire un produit du tenant A même en devinant son UUID', async () => {
    // A crée et récupère l'id
    const created = await request(app.getHttpServer())
      .post('/products')
      .set('X-Dev-Tenant-Id', TENANT_A)
      .set('X-Dev-User-Id', USER_A)
      .send({ sku: 'TEST-GUESS-A', name: 'Produit A', unit_price: 100 })
      .expect(201);
    const productId = created.body.id;

    // B essaie d'accéder par UUID exact → 404 (jamais 200)
    await request(app.getHttpServer())
      .get(`/products/${productId}`)
      .set('X-Dev-Tenant-Id', TENANT_B)
      .set('X-Dev-User-Id', USER_B)
      .expect(404);
  });

  it('API: tenant B ne peut PAS UPDATE un produit du tenant A même en connaissant son UUID', async () => {
    const created = await request(app.getHttpServer())
      .post('/products')
      .set('X-Dev-Tenant-Id', TENANT_A)
      .set('X-Dev-User-Id', USER_A)
      .send({ sku: 'TEST-UPD-A', name: 'Produit A', unit_price: 100 })
      .expect(201);
    const productId = created.body.id;

    await request(app.getHttpServer())
      .patch(`/products/${productId}`)
      .set('X-Dev-Tenant-Id', TENANT_B)
      .set('X-Dev-User-Id', USER_B)
      .send({ name: 'HACKED' })
      .expect(404);

    // Vérification : le produit côté A n'a pas été modifié
    const after = await request(app.getHttpServer())
      .get(`/products/${productId}`)
      .set('X-Dev-Tenant-Id', TENANT_A)
      .set('X-Dev-User-Id', USER_A)
      .expect(200);
    expect(after.body.name).toBe('Produit A');
  });

  it('API: tenant B ne peut PAS DELETE un produit du tenant A', async () => {
    const created = await request(app.getHttpServer())
      .post('/products')
      .set('X-Dev-Tenant-Id', TENANT_A)
      .set('X-Dev-User-Id', USER_A)
      .send({ sku: 'TEST-DEL-A', name: 'Produit A', unit_price: 100 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/products/${created.body.id}`)
      .set('X-Dev-Tenant-Id', TENANT_B)
      .set('X-Dev-User-Id', USER_B)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/products/${created.body.id}`)
      .set('X-Dev-Tenant-Id', TENANT_A)
      .set('X-Dev-User-Id', USER_A)
      .expect(200);
  });

  it('API: requête sans tenant_id en header est rejetée 401', async () => {
    await request(app.getHttpServer()).get('/products').expect(401);
  });

  // -------------------------------------------------------------------------
  // Niveau DB direct (vérifie que la RLS fonctionne hors NestJS)
  // -------------------------------------------------------------------------

  it('DB: avec matix_app + SET app.tenant_id = B, COUNT des produits du tenant A = 0', async () => {
    // Insère un produit côté A via le pool admin
    await adminPool.query(
      `INSERT INTO products (tenant_id, sku, name, unit_price)
       VALUES ($1, 'TEST-DB-A', 'Produit DB A', 50)
       ON CONFLICT (tenant_id, sku) DO NOTHING`,
      [TENANT_A],
    );

    // Connexion avec le compte applicatif (RLS soumis)
    const appPool = new Pool({
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      database: process.env.POSTGRES_DB ?? 'matix',
      user: process.env.POSTGRES_APP_USER ?? 'matix_app',
      password: process.env.POSTGRES_APP_PASSWORD ?? 'matix_app_dev',
    });
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_B]);
      const { rows } = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM products WHERE sku = 'TEST-DB-A'`,
      );
      expect(rows[0].count).toBe('0');
      await client.query('COMMIT');
    } finally {
      client.release();
      await appPool.end();
    }
  });

  it('DB: requête sans app.tenant_id défini → erreur (fail-loud)', async () => {
    const appPool = new Pool({
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      database: process.env.POSTGRES_DB ?? 'matix',
      user: process.env.POSTGRES_APP_USER ?? 'matix_app',
      password: process.env.POSTGRES_APP_PASSWORD ?? 'matix_app_dev',
    });
    try {
      // Pas de SET — la policy current_setting('app.tenant_id') doit lever
      await expect(appPool.query('SELECT * FROM products')).rejects.toThrow();
    } finally {
      await appPool.end();
    }
  });
});
