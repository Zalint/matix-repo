import { auth } from '@/auth';

/**
 * Protège toutes les routes app sauf /login et les endpoints auth.
 * Mode dev (X-Dev-Tenant-Id) : on bypass la middleware en posant DEV_AUTH_BYPASS=true côté env
 * pour permettre la rétrocompat. Sinon, redirige vers /login si non authentifié.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Routes publiques (pas d'auth requise)
  const isPublicRoute =
    pathname.startsWith('/api/auth') ||      // NextAuth
    pathname === '/api/locale' ||            // switch de locale
    pathname === '/login';

  const devBypass = process.env.NEXT_PUBLIC_AUTH_MODE === 'dev';

  if (devBypass) return; // Phase 0 dev : pas d'auth requise

  if (!req.auth && !isPublicRoute) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return Response.redirect(loginUrl);
  }
});

export const config = {
  // exclut les fichiers statiques et l'image optimization
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico)$).*)'],
};
