import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
  NestInterceptor,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Observable, from } from 'rxjs';
import { Pool, PoolClient } from 'pg';
import { APP_PG_POOL } from './database.module';

/**
 * Cœur du multi-tenancy RLS :
 *
 * Pour CHAQUE requête HTTP métier, on :
 *   1. Acquiert un client Postgres dédié sur APP_PG_POOL (utilisateur matix_app, RLS soumis).
 *   2. Ouvre une transaction.
 *   3. Pose `SET LOCAL app.tenant_id = '<uuid>'` (via set_config) — scopé à cette transaction uniquement.
 *   4. Stocke le client dans le CLS sous la clé `pgClient` ; les services métier le récupèrent via `getTenantPgClient()`.
 *   5. À la fin : COMMIT (ou ROLLBACK si erreur) et release du client.
 *
 * Conséquence : aucun service métier ne peut "oublier" de filtrer par tenant_id —
 *               c'est la DB qui filtre, via la policy RLS.
 *
 * Les routes admin/* sont exclues du middleware tenant context, et leurs services
 * doivent utiliser explicitement ADMIN_PG_POOL.
 */
@Injectable()
export class TenantTxInterceptor implements NestInterceptor {
  constructor(
    @Inject(APP_PG_POOL) private readonly pool: Pool,
    private readonly cls: ClsService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.runInTenantTx(next));
  }

  private async runInTenantTx(next: CallHandler): Promise<unknown> {
    const tenantId = this.cls.get<string>('tenantId');
    if (!tenantId) {
      // Pas de tenant context — route admin ou route exclue. On ne pose pas de tx.
      return next.handle().toPromise();
    }

    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // set_config(name, value, is_local=true) ⇔ SET LOCAL — scopé à la tx en cours.
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      this.cls.set('pgClient', client);

      const result = await next.handle().toPromise();

      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // log mais on remonte l'erreur originale
      }
      throw err;
    } finally {
      this.cls.set('pgClient', undefined);
      client.release();
    }
  }
}

/**
 * Helper pour les services métier — récupère le client Postgres scopé au tenant courant.
 * Lève si appelé hors d'une requête HTTP métier (ex: dans un service admin).
 */
export function getTenantPgClient(cls: ClsService): PoolClient {
  const client = cls.get<PoolClient>('pgClient');
  if (!client) {
    throw new InternalServerErrorException(
      'Pas de tenant DB context — êtes-vous sur une route métier ? (route admin ? worker ?)',
    );
  }
  return client;
}
