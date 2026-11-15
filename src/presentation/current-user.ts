import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { User } from '../domain/entities.js';
import { UnauthorizedError } from '../domain/errors.js';
import type { AuthService } from '../services/auth-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the authentication hook on every non-public route. */
    currentUser?: User;
  }
}

export type GetCurrentUser = (request: FastifyRequest) => User;

/** Returns the user the authentication hook resolved for this request. */
export const getCurrentUser: GetCurrentUser = (request) => {
  if (!request.currentUser) throw new UnauthorizedError('Authentication required');
  return request.currentUser;
};

/** Public routes, matched on method and route pattern (not the raw URL). */
const PUBLIC_ROUTES = new Set(['POST /auth/register', 'POST /auth/login']);

/** Swagger UI serves its page, assets and the spec JSON under this prefix. */
const DOCS_PREFIX = '/docs';

function isPublic(request: FastifyRequest): boolean {
  const pattern = request.routeOptions.url;
  if (!pattern) return false; // unmatched routes are not public
  if (pattern === DOCS_PREFIX || pattern.startsWith(`${DOCS_PREFIX}/`)) return true;
  return PUBLIC_ROUTES.has(`${request.method} ${pattern}`);
}

const BEARER = /^Bearer ([^\s]+)$/i;

/**
 * Authenticates every request except the public allow-list, before body
 * parsing and validation. Register it on the root instance before any route:
 * routes added later are protected by default.
 */
export function registerAuthentication(app: FastifyInstance, auth: AuthService): void {
  app.decorateRequest('currentUser', undefined);
  app.addHook('onRequest', async (request) => {
    if (isPublic(request)) return;
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedError('Missing or malformed bearer token');
    let sub: unknown;
    try {
      ({ sub } = app.jwt.verify<{ sub?: unknown }>(token));
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
    if (typeof sub !== 'string') throw new UnauthorizedError('Invalid or expired token');
    request.currentUser = auth.findById(sub);
  });
}
