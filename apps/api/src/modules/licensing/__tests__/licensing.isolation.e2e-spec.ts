/**
 * Tests du module Licensing :
 *  - 402 si module non licencié
 *  - 403 si rôle insuffisant
 *  - 200 si licence + rôle OK
 *  - Catalogue + plans accessibles publiquement
 *  - Assignation de plan via admin endpoint
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';

import { AppModule } from '../../../app.module';
import { ADMIN_PG_POOL } from '../../../common/database.module';

const TENANT_A = 'a1111111-1111-4111-8111-111111111111';
const USER_A = 'aa111111-1111-4111-8111-111111111111';

describe('Licensing — guard + admin', () => {
  let app: INestApplication;
  let adminPool: Pool;

  beforeAll(async () => {
    process.env.AUTH_MODE = 'dev';
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    adminPool = app.get(ADMIN_PG_POOL);

    // S'assure que TENANT_A n'a aucune licence sales.pos pour le premier test
    await adminPool.query(
      `DELETE FROM tenant_licenses WHERE tenant_id = $1 AND module_code = 'commercial.sales.pos'`,
      [TENANT_A],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const headers = (tenant: string, user: string, role = 'owner') => ({
    'X-Dev-Tenant-Id': tenant,
    'X-Dev-User-Id': user,
    'X-Dev-Role': role,
  });

  it('GET /licensing/catalog — public, retourne 45+ modules', async () => {
    const r = await request(app.getHttpServer()).get('/licensing/catalog').expect(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThan(40);
    expect(r.body.find((m: { code: string }) => m.code === 'commercial.sales.pos')).toBeDefined();
  });

  it('GET /licensing/plans — retourne les 4 plans', async () => {
    const r = await request(app.getHttpServer()).get('/licensing/plans').expect(200);
    const codes = r.body.map((p: { code: string }) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['free', 'starter', 'pro', 'enterprise']));
  });

  it('GET /sales SANS licence sales.pos → 402 Payment Required', async () => {
    await request(app.getHttpServer())
      .get('/sales')
      .set(headers(TENANT_A, USER_A))
      .expect(402);
  });

  it('PATCH /admin/licensing/tenants/:id/plan — assigner Free → débloque les modules de base', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/licensing/${TENANT_A}/plan`)
      .send({ plan_code: 'free' })
      .expect(200);

    // sales.pos est inclus dans Free → /sales doit retourner 200 maintenant
    await request(app.getHttpServer())
      .get('/sales')
      .set(headers(TENANT_A, USER_A))
      .expect(200);
  });

  it('GET /sales en rôle readonly → 200 (lecture autorisée)', async () => {
    await request(app.getHttpServer())
      .get('/sales')
      .set(headers(TENANT_A, USER_A, 'readonly'))
      .expect(200);
  });

  it('POST /sales en rôle readonly → 403 (write interdit)', async () => {
    await request(app.getHttpServer())
      .post('/sales')
      .set(headers(TENANT_A, USER_A, 'readonly'))
      .send({
        point_of_sale_id: '00000000-0000-4000-8000-000000000000',
        items: [{ product_id: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
      })
      .expect(403);
  });

  it('GET /licensing/me — retourne les modules activés', async () => {
    const r = await request(app.getHttpServer())
      .get('/licensing/me')
      .set(headers(TENANT_A, USER_A))
      .expect(200);
    const codes = r.body.map((l: { module_code: string }) => l.module_code);
    expect(codes).toContain('commercial.sales.pos');
    expect(codes).toContain('platform.identity');
  });

  it('GET /licensing/me/permissions — retourne les actions par module', async () => {
    const r = await request(app.getHttpServer())
      .get('/licensing/me/permissions')
      .set(headers(TENANT_A, USER_A, 'readonly'))
      .expect(200);
    const sales = r.body.find((p: { module: string }) => p.module === 'commercial.sales.pos');
    expect(sales).toBeDefined();
    expect(sales.actions).toEqual(['read']);
  });

  it('Assigner Enterprise → tenant a accès à tout le catalogue actif', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/licensing/${TENANT_A}/plan`)
      .send({ plan_code: 'enterprise' })
      .expect(200);

    const r = await request(app.getHttpServer())
      .get('/licensing/me')
      .set(headers(TENANT_A, USER_A))
      .expect(200);
    expect(r.body.length).toBeGreaterThan(40);  // tout le catalogue actif/beta

    // Restore Free pour les autres tests
    await request(app.getHttpServer())
      .patch(`/admin/licensing/${TENANT_A}/plan`)
      .send({ plan_code: 'free' })
      .expect(200);
  });
});
