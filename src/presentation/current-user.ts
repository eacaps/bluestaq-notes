import type { FastifyRequest } from 'fastify';
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
