/**
 * NOTE — la logique d'extraction tenant est dans `app.module.ts` via `ClsModule.forRoot({ setup })`.
 *
 * Raison : le middleware NestJS configuré par `consumer.apply()` peut s'exécuter AVANT
 * le middleware CLS auto-monté, ce qui rend `cls.set()` non-fonctionnel ("No CLS context").
 * Le `setup` du ClsModule s'exécute dans le contexte CLS garanti, donc cls.set() y marche.
 *
 * Ce fichier est conservé pour rétrocompatibilité d'imports si un consommateur en a besoin.
 */
export {};
