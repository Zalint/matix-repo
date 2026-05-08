/**
 * Tests anti-fuite RLS du module CRM Customers.
 * Conforme ADR-0002 §8 (obligatoires) et ADR-0001 §9.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';

import { AppModule } from '../../../app.module';
import { ADMIN_PG_POOL } from '../../../common/database.module';

const TENANT_A = 'a1111111-1111-4111-8111-111111111111';
const USER_A = 'a1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'b2222222-2222-4222-8222-222222222222';
const USER_B = 'b2222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('Customers — multi-tenant isolation', () => {
  let app: INestApplication;
  let adminPool: Pool;

  beforeAll(async () => {
    process.env.DEV_AUTH_ENABLED = 'true';
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    adminPool = app.get(ADMIN_PG_POOL);
    await adminPool.query(`DELETE FROM customers WHERE code LIKE 'ITEST-%'`);
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM customers WHERE code LIKE 'ITEST-%'`);
    await app.close();
  });

  const headers = (tenant: string, user: string) => ({
    'X-Dev-Tenant-Id': tenant,
    'X-Dev-User-Id': user,
  });

  it('B ne voit jamais un client de A', async () => {
    await request(app.getHttpServer())
      .post('/customers')
      .set(headers(TENANT_A, USER_A))
      .send({ code: 'ITEST-CUST-A1', display_name: 'Acme Corp client', phone: '+221770000001' })
      .expect(201);

    const res = await request(app.getHttpServer()).get('/customers').set(headers(TENANT_B, USER_B)).expect(200);
    expect(res.body.find((c: { code: string }) => c.code === 'ITEST-CUST-A1')).toBeUndefined();
  });

  it('B ne peut pas GET un client de A même avec UUID exact', async () => {
    const created = await request(app.getHttpServer())
      .post('/customers')
      .set(headers(TENANT_A, USER_A))
      .send({ code: 'ITEST-CUST-A2', display_name: 'Acme client 2' })
      .expect(201);

    await request(app.getHttpServer()).get(`/customers/${created.body.id}`).set(headers(TENANT_B, USER_B)).expect(404);
  });

  it('B ne peut pas UPDATE un client de A', async () => {
    const created = await request(app.getHttpServer())
      .post('/customers')
      .set(headers(TENANT_A, USER_A))
      .send({ code: 'ITEST-CUST-A3', display_name: 'Original' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/customers/${created.body.id}`)
      .set(headers(TENANT_B, USER_B))
      .send({ display_name: 'HACKED' })
      .expect(404);

    const after = await request(app.getHttpServer())
      .get(`/customers/${created.body.id}`)
      .set(headers(TENANT_A, USER_A))
      .expect(200);
    expect(after.body.display_name).toBe('Original');
  });

  it('B ne peut pas DELETE un client de A', async () => {
    const created = await request(app.getHttpServer())
      .post('/customers')
      .set(headers(TENANT_A, USER_A))
      .send({ code: 'ITEST-CUST-A4', display_name: 'Pas suppression' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/customers/${created.body.id}`)
      .set(headers(TENANT_B, USER_B))
      .expect(404);

    await request(app.getHttpServer())
      .get(`/customers/${created.body.id}`)
      .set(headers(TENANT_A, USER_A))
      .expect(200);
  });

  it('Code identique autorisé entre 2 tenants (UNIQUE = par tenant)', async () => {
    await request(app.getHttpServer())
      .post('/customers')
      .set(headers(TENANT_A, USER_A))
      .send({ code: 'ITEST-SHARED', display_name: 'Chez ACME' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/customers')
      .set(headers(TENANT_B, USER_B))
      .send({ code: 'ITEST-SHARED', display_name: 'Chez BETA' })
      .expect(201);
  });

  it('Code dupliqué dans MEME tenant → 409 Conflict', async () => {
    await request(app.getHttpServer())
      .post('/customers')
      .set(headers(TENANT_A, USER_A))
      .send({ code: 'ITEST-DUP', display_name: 'Premier' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/customers')
      .set(headers(TENANT_A, USER_A))
      .send({ code: 'ITEST-DUP', display_name: 'Second' })
      .expect(409);
  });

  it('DB direct: SET tenant=B + SELECT WHERE tenant_id=A → 0 rows', async () => {
    await adminPool.query(
      `INSERT INTO customers (tenant_id, code, display_name) VALUES ($1, 'ITEST-DB-A', 'DB direct A')
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [TENANT_A],
    );
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
        `SELECT COUNT(*)::text AS count FROM customers WHERE code = 'ITEST-DB-A'`,
      );
      expect(rows[0].count).toBe('0');
      await client.query('COMMIT');
    } finally {
      client.release();
      await appPool.end();
    }
  });
});
