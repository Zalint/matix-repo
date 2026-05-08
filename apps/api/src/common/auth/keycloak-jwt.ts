import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

/**
 * Vérifie un JWT Keycloak et retourne ses claims.
 *
 * - Récupère les clés publiques depuis le JWKS endpoint du realm.
 * - jose cache les clés ~10 min par défaut (key-rotation safe).
 * - Vérifie : signature, iss, aud, exp, nbf.
 *
 * Configuration via env :
 *   KEYCLOAK_ISSUER  = http://localhost:8080/realms/matix
 *   KEYCLOAK_AUDIENCE = matix-api
 */

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
let configuredIssuer: string | null = null;

function getJwks(issuer: string) {
  if (!jwksCache || configuredIssuer !== issuer) {
    jwksCache = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));
    configuredIssuer = issuer;
  }
  return jwksCache;
}

export type MatixJwtClaims = JWTPayload & {
  sub: string;
  tenant_id?: string;
  tenant_ids?: string[];
  email?: string;
  realm_access?: { roles?: string[] };
};

export async function verifyKeycloakJwt(token: string): Promise<MatixJwtClaims> {
  const issuer = process.env.KEYCLOAK_ISSUER;
  const audience = process.env.KEYCLOAK_AUDIENCE ?? 'matix-api';
  if (!issuer) {
    throw new Error('KEYCLOAK_ISSUER non configuré');
  }
  const jwks = getJwks(issuer);
  const { payload } = await jwtVerify(token, jwks, { issuer, audience });
  if (!payload.sub) throw new Error('JWT sans sub');
  return payload as MatixJwtClaims;
}
