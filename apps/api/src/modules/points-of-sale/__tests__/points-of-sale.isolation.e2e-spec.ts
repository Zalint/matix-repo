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

describe('PointsOfSale — multi-tenant isolation', () => {
  let app: INestApplication;
  let adminPool: Pool;

  beforeAll(async () => {
    process.env.AUTH_MODE = 'dev';
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    adminPool = app.get(ADMIN_PG_POOL);
    await adminPool.query(`DELETE FROM points_of_sale WHERE code IN ('itest-pv-a1','itest-pv-a2','itest-pv-upd','itest-dup','itest-shared','itest-del')`);
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM points_of_sale WHERE code IN ('itest-pv-a1','itest-pv-a2','itest-pv-upd','itest-dup','itest-shared','itest-del')`);
    await app.close();
  });

  const headers = (tenant: string, user: string) => ({
    'X-Dev-Tenant-Id': tenant,
    'X-Dev-User-Id': user,
  });

  it('B ne voit pas un PV de A', async () => {
    await request(app.getHttpServer())
      .post('/points-of-sale')
      .set(headers(TENANT_A, USER_A))
      .send({ code: 'itest-pv-a1', name: 'PV ACME 1' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/points-of-sale')
      .set(headers(TENANT_B, USER_B))
      .expect(200);
    expect(res.body.find((p: { code: string }) => p.code === 'itest-pv-a1')).toBeUndefined();
  });

  it('B ne peut pas GET un PV de A même avec UUID exact', async () => {
    const created = await request(app.getHttpServer())
      .post('/points-of-sale')
      .set(headers(TENANT_A, USER_A))
      .send({ code: 'itest-pv-a2', name: 'PV ACME 2' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/points-of-sale/${created.body.id}`)
      .set(headers(TENANT_B, USER_B))
      .expect(404);
  });

  it('B ne peut pas UPDATE un PV de A', async () => {
    const created = await request(app.getHttpServer())
      .post('/points-of-sale')
      .set(headers(TENANT_A, USER_A))
      .send({ code: 'itest-pv-upd', name: 'Original' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/points-of-sale/${created.body.id}`)
      .set(headers(TENANT_B, USER_B))
      .send({ name: 'HACKED' })
      .expect(404);

    const after = await request(app.getHttpServer())
      .get(`/points-of-sale/${created.body.id}`)
      .set(headers(TENANT_A, USER_A))
      .expect(200);
    expect(after.body.name).toBe('Original');
  });

  it('Code dupliqué dans MEME tenant → 409', async () => {
    await request(app.getHttpServer())
      .post('/points-of-sale')
      .set(headers(TENANT_A, USER_A))
      .send({ code: 'itest-dup', name: 'Premier' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/points-of-sale')
      .set(headers(TENANT_A, USER_A))
      .send({ code: 'itest-dup', name: 'Second' })
      .expect(409);
  });

  it('Même code OK entre 2 tenants', async () => {
    await request(app.getHttpServer())
      .post('/points-of-sale')
      .set(headers(TENANT_A, USER_A))
      .send({ code: 'itest-shared', name: 'Chez A' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/points-of-sale')
      .set(headers(TENANT_B, USER_B))
      .send({ code: 'itest-shared', name: 'Chez B' })
      .expect(201);
  });

  it('Soft-delete : PV disparait du list mais row gardée', async () => {
    const created = await request(app.getHttpServer())
      .post('/points-of-sale')
      .set(headers(TENANT_A, USER_A))
      .send({ code: 'itest-del', name: 'À supprimer' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/points-of-sale/${created.body.id}`)
      .set(headers(TENANT_A, USER_A))
      .expect(204);

    const list = await request(app.getHttpServer())
      .get('/points-of-sale')
      .set(headers(TENANT_A, USER_A))
      .expect(200);
    expect(list.body.find((p: { code: string }) => p.code === 'itest-del')).toBeUndefined();

    // Row toujours en DB (admin pool, BYPASSRLS)
    const { rows } = await adminPool.query(`SELECT deleted_at FROM points_of_sale WHERE code = 'itest-del' AND tenant_id = $1`, [TENANT_A]);
    expect(rows[0].deleted_at).not.toBeNull();
  });
});
