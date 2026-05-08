"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const common_1 = require("@nestjs/common");
const supertest_1 = __importDefault(require("supertest"));
const pg_1 = require("pg");
const app_module_1 = require("../src/app.module");
const database_module_1 = require("../src/common/database.module");
const TENANT_A = 'a1111111-1111-4111-8111-111111111111';
const USER_A = 'a1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'b2222222-2222-4222-8222-222222222222';
const USER_B = 'b2222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
describe('Multi-tenant isolation (RLS)', () => {
    let app;
    let adminPool;
    beforeAll(async () => {
        process.env.DEV_AUTH_ENABLED = 'true';
        const moduleRef = await testing_1.Test.createTestingModule({
            imports: [app_module_1.AppModule],
        }).compile();
        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new common_1.ValidationPipe({ transform: true, whitelist: true }));
        await app.init();
        adminPool = app.get(database_module_1.ADMIN_PG_POOL);
        await adminPool.query(`DELETE FROM products WHERE sku LIKE 'TEST-%'`);
    });
    afterAll(async () => {
        await adminPool.query(`DELETE FROM products WHERE sku LIKE 'TEST-%'`);
        await app.close();
    });
    it('API: tenant B ne voit JAMAIS les produits du tenant A', async () => {
        await (0, supertest_1.default)(app.getHttpServer())
            .post('/products')
            .set('X-Dev-Tenant-Id', TENANT_A)
            .set('X-Dev-User-Id', USER_A)
            .send({ sku: 'TEST-SECRET-A', name: 'Produit secret A', unit_price: 9999 })
            .expect(201);
        const res = await (0, supertest_1.default)(app.getHttpServer())
            .get('/products')
            .set('X-Dev-Tenant-Id', TENANT_B)
            .set('X-Dev-User-Id', USER_B)
            .expect(200);
        expect(res.body.find((p) => p.sku === 'TEST-SECRET-A')).toBeUndefined();
    });
    it('API: tenant B ne peut PAS lire un produit du tenant A même en devinant son UUID', async () => {
        const created = await (0, supertest_1.default)(app.getHttpServer())
            .post('/products')
            .set('X-Dev-Tenant-Id', TENANT_A)
            .set('X-Dev-User-Id', USER_A)
            .send({ sku: 'TEST-GUESS-A', name: 'Produit A', unit_price: 100 })
            .expect(201);
        const productId = created.body.id;
        await (0, supertest_1.default)(app.getHttpServer())
            .get(`/products/${productId}`)
            .set('X-Dev-Tenant-Id', TENANT_B)
            .set('X-Dev-User-Id', USER_B)
            .expect(404);
    });
    it('API: tenant B ne peut PAS UPDATE un produit du tenant A même en connaissant son UUID', async () => {
        const created = await (0, supertest_1.default)(app.getHttpServer())
            .post('/products')
            .set('X-Dev-Tenant-Id', TENANT_A)
            .set('X-Dev-User-Id', USER_A)
            .send({ sku: 'TEST-UPD-A', name: 'Produit A', unit_price: 100 })
            .expect(201);
        const productId = created.body.id;
        await (0, supertest_1.default)(app.getHttpServer())
            .patch(`/products/${productId}`)
            .set('X-Dev-Tenant-Id', TENANT_B)
            .set('X-Dev-User-Id', USER_B)
            .send({ name: 'HACKED' })
            .expect(404);
        const after = await (0, supertest_1.default)(app.getHttpServer())
            .get(`/products/${productId}`)
            .set('X-Dev-Tenant-Id', TENANT_A)
            .set('X-Dev-User-Id', USER_A)
            .expect(200);
        expect(after.body.name).toBe('Produit A');
    });
    it('API: tenant B ne peut PAS DELETE un produit du tenant A', async () => {
        const created = await (0, supertest_1.default)(app.getHttpServer())
            .post('/products')
            .set('X-Dev-Tenant-Id', TENANT_A)
            .set('X-Dev-User-Id', USER_A)
            .send({ sku: 'TEST-DEL-A', name: 'Produit A', unit_price: 100 })
            .expect(201);
        await (0, supertest_1.default)(app.getHttpServer())
            .delete(`/products/${created.body.id}`)
            .set('X-Dev-Tenant-Id', TENANT_B)
            .set('X-Dev-User-Id', USER_B)
            .expect(404);
        await (0, supertest_1.default)(app.getHttpServer())
            .get(`/products/${created.body.id}`)
            .set('X-Dev-Tenant-Id', TENANT_A)
            .set('X-Dev-User-Id', USER_A)
            .expect(200);
    });
    it('API: requête sans tenant_id en header est rejetée 401', async () => {
        await (0, supertest_1.default)(app.getHttpServer()).get('/products').expect(401);
    });
    it('DB: avec matix_app + SET app.tenant_id = B, COUNT des produits du tenant A = 0', async () => {
        await adminPool.query(`INSERT INTO products (tenant_id, sku, name, unit_price)
       VALUES ($1, 'TEST-DB-A', 'Produit DB A', 50)
       ON CONFLICT (tenant_id, sku) DO NOTHING`, [TENANT_A]);
        const appPool = new pg_1.Pool({
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
            const { rows } = await client.query(`SELECT COUNT(*)::text AS count FROM products WHERE sku = 'TEST-DB-A'`);
            expect(rows[0].count).toBe('0');
            await client.query('COMMIT');
        }
        finally {
            client.release();
            await appPool.end();
        }
    });
    it('DB: requête sans app.tenant_id défini → erreur (fail-loud)', async () => {
        const appPool = new pg_1.Pool({
            host: process.env.POSTGRES_HOST ?? 'localhost',
            port: Number(process.env.POSTGRES_PORT ?? 5432),
            database: process.env.POSTGRES_DB ?? 'matix',
            user: process.env.POSTGRES_APP_USER ?? 'matix_app',
            password: process.env.POSTGRES_APP_PASSWORD ?? 'matix_app_dev',
        });
        try {
            await expect(appPool.query('SELECT * FROM products')).rejects.toThrow();
        }
        finally {
            await appPool.end();
        }
    });
});
