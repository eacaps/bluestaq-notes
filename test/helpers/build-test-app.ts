import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.js';
import { DEFAULT_USER_EMAIL } from '../../src/data/seed.js';

export { DEFAULT_USER_EMAIL };

/** Fixed secret for tests. It is an AppOptions argument, so no env var is needed. */
export const TEST_JWT_SECRET = 'test-secret';

export interface BuildTestAppOptions {
  jwtSecret?: string;
  jwtExpiresIn?: string | number;
  dbPath?: string;
}

/** Fresh app on its own in-memory database. Callers close it. */
export async function buildTestApp(opts: BuildTestAppOptions = {}): Promise<FastifyInstance> {
  const app = await buildApp({
    dbPath: opts.dbPath ?? ':memory:',
    jwtSecret: opts.jwtSecret ?? TEST_JWT_SECRET,
    jwtExpiresIn: opts.jwtExpiresIn ?? '1h',
    logger: false,
  });
  await app.ready();
  return app;
}

export interface UserBody {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface TeamBody {
  id: string;
  name: string;
  created_at: string;
}

export interface NoteBody {
  id: string;
  owner_id: string;
  title: string;
  body: string;
  team_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Session {
  token: string;
  user: UserBody;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export async function loginAs(app: FastifyInstance, email: string): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email } });
  if (res.statusCode !== 200) throw new Error(`loginAs failed: ${res.statusCode} ${res.body}`);
  return res.json<Session>();
}

export async function registerUser(
  app: FastifyInstance,
  email: string,
  name: string,
): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, name } });
  if (res.statusCode !== 201) throw new Error(`registerUser failed: ${res.statusCode} ${res.body}`);
  return res.json<Session>();
}

export const defaultUserToken = (app: FastifyInstance) => loginAs(app, DEFAULT_USER_EMAIL);

/** Thin client that sends the bearer token on every call. */
export function as(app: FastifyInstance, token: string) {
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: bearer(token),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  return {
    get: (url: string): Promise<LightMyRequestResponse> => call('GET', url),
    post: (url: string, payload?: unknown) => call('POST', url, payload),
    patch: (url: string, payload?: unknown) => call('PATCH', url, payload),
    put: (url: string, payload?: unknown) => call('PUT', url, payload),
    delete: (url: string) => call('DELETE', url),
  };
}

export async function createTeam(app: FastifyInstance, name: string, token: string) {
  const res = await as(app, token).post('/teams', { name });
  if (res.statusCode !== 201) throw new Error(`createTeam failed: ${res.statusCode} ${res.body}`);
  return res.json<TeamBody>();
}

export async function createNote(
  app: FastifyInstance,
  payload: { title: string; body: string; team_ids?: string[] },
  token: string,
) {
  const res = await as(app, token).post('/notes', payload);
  if (res.statusCode !== 201) throw new Error(`createNote failed: ${res.statusCode} ${res.body}`);
  return res.json<NoteBody>();
}

export async function addMember(app: FastifyInstance, token: string, teamId: string, userId: string) {
  const res = await as(app, token).put(`/teams/${teamId}/members/${userId}`);
  if (res.statusCode !== 204) throw new Error(`addMember failed: ${res.statusCode} ${res.body}`);
}
