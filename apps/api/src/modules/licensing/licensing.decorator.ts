import { SetMetadata } from '@nestjs/common';
import type { ModuleAction } from './catalog';

export const REQUIRES_MODULE_KEY = 'matix:requires-module';

export type RequiresModuleSpec = {
  moduleCode: string;
  action: ModuleAction;
};

/**
 * Marque un endpoint comme nécessitant qu'un module soit licencié pour le tenant
 * ET que l'utilisateur ait la permission `action` sur ce module.
 *
 * Ex : `@RequiresModule('commercial.sales.pos', 'write')`
 *
 * Le LicensingGuard fait :
 *   1. tenant_licenses.enabled = TRUE pour ce module → sinon 402
 *   2. user.role permet `action` sur ce module → sinon 403
 */
export const RequiresModule = (moduleCode: string, action: ModuleAction) =>
  SetMetadata(REQUIRES_MODULE_KEY, { moduleCode, action } as RequiresModuleSpec);
