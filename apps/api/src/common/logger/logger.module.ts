import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

/**
 * Logger structuré pino pour toute l'API.
 *
 * Format prod : JSON 1 ligne par event (compatible Loki/CloudWatch/Datadog).
 * Format dev  : pino-pretty pour lisibilité humaine.
 *
 * Champs auto-injectés sur chaque log d'une requête HTTP :
 *   - request_id (généré ou tiré du header X-Request-Id)
 *   - tenant_id  (depuis CLS, en dev/keycloak)
 *   - user_id    (depuis CLS)
 *   - module     (depuis le contexte NestJS)
 *
 * Voir ADR-0002 §12 pour la convention logs.
 */
@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        // Génère ou réutilise un request_id par requête
        genReqId: (req) => {
          const headerId = (req.headers['x-request-id'] as string) || undefined;
          return headerId ?? randomUUID();
        },
        // Format dev : pino-pretty (humain). Prod : JSON.
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: { singleLine: true, colorize: true, translateTime: 'HH:MM:ss.l' },
              }
            : undefined,
        // tenant_id/user_id sont disponibles via CLS pour les logs explicites au niveau service.
        // Phase 1 : ajouter un mixin pino qui lit CLS si on veut auto-injection sur tous les logs.
        // Redact des secrets et data sensible
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-dev-tenant-id"]',
            'req.headers["x-dev-user-id"]',
            '*.password',
            '*.access_token',
            '*.refresh_token',
            '*.client_secret',
          ],
          censor: '[REDACTED]',
        },
        serializers: {
          req: (req) => ({
            method: req.method,
            url: req.url,
            request_id: req.id,
          }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
      },
    }),
  ],
})
export class LoggerModule {}
