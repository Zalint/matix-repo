import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Healthchecks plateforme. Routes ouvertes (pas de tenant context).
 *
 * - GET /health     : ping + version + uptime + DB ping (lent)
 * - GET /healthz    : alias court (k8s-style)
 * - GET /readyz     : version "ready" — vérifie DB et Keycloak (le cas échéant)
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
