import { PageSpinner } from '@/components/ui/spinner';

/**
 * Fallback affiché automatiquement par Next.js pendant le chargement initial
 * d'une route du segment (app). Réduit l'effet "écran vide" quand on navigue
 * entre Stock matin / Transferts / Découpes / Stock soir / etc.
 *
 * Note : ce loading.tsx ne se déclenche qu'au PREMIER affichage de la route
 * (cold render Server Component). Les fetch côté client après navigation
 * doivent gérer leur propre spinner local.
 */
export default function Loading() {
  return <PageSpinner />;
}
