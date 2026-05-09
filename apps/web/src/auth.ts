import NextAuth, { type DefaultSession } from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';

/**
 * Auth.js v5 — config Keycloak.
 *
 * Phase 0 dev :
 *   - Issuer http://localhost:8081/realms/matix
 *   - Client matix-web (confidential, secret en .env.local)
 *   - Callback http://localhost:3000/api/auth/callback/keycloak
 *
 * Phase 1+ : prod values via env, refresh token rotation, session DB-backed, etc.
 */
declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    tenantId?: string;
    tenantIds?: string[];
    error?: 'RefreshAccessTokenError' | string;
    user: { email?: string | null; name?: string | null } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpiresAt?: number;
    tenantId?: string;
    tenantIds?: string[];
    error?: string;
  }
}

function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  try {
    const part = token.split('.')[1];
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
    const json = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Keycloak({
      clientId: process.env.KEYCLOAK_CLIENT_ID,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
      issuer: process.env.KEYCLOAK_ISSUER,
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, account }) {
      // Au login initial, account contient les tokens Keycloak
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.accessTokenExpiresAt =
          account.expires_at ?? Math.floor(Date.now() / 1000) + (account.expires_in ?? 900);

        const claims = account.access_token ? decodeJwtPayload<{
          tenant_id?: string;
          tenant_ids?: string[];
        }>(account.access_token) : null;
        if (claims) {
          token.tenantId = claims.tenant_id;
          token.tenantIds = Array.isArray(claims.tenant_ids) ? claims.tenant_ids : claims.tenant_ids ? [claims.tenant_ids as unknown as string] : undefined;
        }
        return token;
      }

      // Pas encore expiré
      if (token.accessTokenExpiresAt && Date.now() < token.accessTokenExpiresAt * 1000 - 60_000) {
        return token;
      }

      // Refresh
      try {
        const issuer = process.env.KEYCLOAK_ISSUER!;
        const res = await fetch(`${issuer}/protocol/openid-connect/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: process.env.KEYCLOAK_CLIENT_ID!,
            client_secret: process.env.KEYCLOAK_CLIENT_SECRET!,
            refresh_token: token.refreshToken ?? '',
          }),
        });
        const refreshed = (await res.json()) as {
          access_token?: string;
          expires_in?: number;
          refresh_token?: string;
          error?: string;
        };
        if (!res.ok || !refreshed.access_token) {
          throw new Error(refreshed.error ?? 'refresh failed');
        }
        token.accessToken = refreshed.access_token;
        token.refreshToken = refreshed.refresh_token ?? token.refreshToken;
        token.accessTokenExpiresAt = Math.floor(Date.now() / 1000) + (refreshed.expires_in ?? 900);
        return token;
      } catch (e) {
        token.error = 'RefreshAccessTokenError';
        return token;
      }
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.tenantId = token.tenantId;
      session.tenantIds = token.tenantIds;
      session.error = token.error;
      return session;
    },
  },
});
