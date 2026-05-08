import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

/**
 * Module manifest — voir ADR-0002 §6.
 * Sert à la doc auto, au scan RLS en CI, et à la visualisation des dépendances inter-modules.
 */
export const MODULE_MANIFEST = {
  name: 'customers',
  pillar: 'commercial' as const,
  tables: ['customers'] as const,
  emitsEvents: [] as const,        // À ajouter quand un autre module aura besoin de réagir
  publicFacade: null,              // Pas encore de facade — Sales en aura besoin Phase 1
};

@Module({
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [],                      // Aucun service exporté — tout est privé pour l'instant
})
export class CustomersModule {}
