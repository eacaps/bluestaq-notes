import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { User } from '../domain/entities.js';

export type GetCurrentUser = (request: FastifyRequest) => User;

/**
 * Stage 1: every request acts as the seeded default user.
 * Stage 2a replaces this with a bearer-token lookup that rejects with 401.
 */
export const defaultUserResolver =
  (user: User): GetCurrentUser =>
  () =>
    user;

/**
 * Runs the resolver on every request to the given (encapsulated) plugin
 * instance, before body parsing and validation, so a resolver that throws
 * (stage 2a: 401) rejects the request before anything else is checked. Every
 * API plugin must call this; docs and the not-found handler stay public.
 */
export function requireUser(app: FastifyInstance, getCurrentUser: GetCurrentUser): void {
  app.addHook('onRequest', async (request) => {
    getCurrentUser(request);
  });
}
