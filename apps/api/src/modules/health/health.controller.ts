import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Pool } from 'pg';
import { ADMIN_PG_POOL } from '../../common/database.module';

const START_TIME = Date.now();
const VERSION = process.env.npm_package_version ?? '0.0.0';

@Controller()
export class HealthController {
  constructor(@Inject(ADMIN_PG_POOL) private readonly pool: Pool) {}

  /** Liveness : l'API répond. Toujours 200 si l'app boot. */
  @Get(['health', 'healthz'])
  liveness() {
    return {
      status: 'ok',
      version: VERSION,
      uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
      time: new Date().toISOString(),
    };
  }

  /** Readiness : l'API est prête à servir du trafic — vérifie DB + Keycloak (best-effort). */
  @Get('readyz')
  async readiness(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, { ok: boolean; latency_ms?: number; error?: string }> = {};

    // DB
    const dbStart = Date.now();
    try {
      await this.pool.query('SELECT 1');
      checks.database = { ok: true, latency_ms: Date.now() - dbStart };
    } catch (e) {
      checks.database = { ok: false, error: (e as Error).message };
    }

    // Keycloak (uniquement si AUTH_MODE=keycloak — sinon on skip)
    if (process.env.AUTH_MODE === 'keycloak') {
      const issuer = process.env.KEYCLOAK_ISSUER;
      if (issuer) {
        const kcStart = Date.now();
        try {
          const r = await fetch(`${issuer}/.well-known/openid-configuration`);
          checks.keycloak = { ok: r.ok, latency_ms: Date.now() - kcStart };
        } catch (e) {
          checks.keycloak = { ok: false, error: (e as Error).message };
        }
      }
    }

    const allOk = Object.values(checks).every((c) => c.ok);
    if (!allOk) res.status(HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: allOk ? 'ready' : 'degraded',
      version: VERSION,
      checks,
    };
  }
}
