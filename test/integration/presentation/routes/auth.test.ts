import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_USER_EMAIL,
  as,
  bearer,
  buildTestApp,
  defaultUserToken,
  registerUser,
  type Session,
} from '../../../helpers/build-test-app.js';

describe('auth routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });
  afterEach(() => app.close());

  const register = (payload: unknown) =>
    app.inject({ method: 'POST', url: '/auth/register', payload: payload as object });
  const login = (payload: unknown) =>
    app.inject({ method: 'POST', url: '/auth/login', payload: payload as object });
  const errorShape = (body: unknown) => expect(Object.keys(body as object).sort()).toEqual(['error', 'message']);

  describe('POST /auth/register', () => {
    it('returns 201 with a token and the user, normalized, and nothing else', async () => {
      const res = await register({ email: '  Ann@Example.COM ', name: '  Ann  ' });
      expect(res.statusCode).toBe(201);
      const body = res.json<Session>();
      expect(Object.keys(body).sort()).toEqual(['token', 'user']);
      expect(Object.keys(body.user).sort()).toEqual(['created_at', 'email', 'id', 'name']);
      expect(body.user).toMatchObject({ email: 'ann@example.com', name: 'Ann' });
      expect(body.user.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns a token that works on GET /users/me', async () => {
      const { token, user } = (await register({ email: 'a@x.y', name: 'A' })).json<Session>();
      const me = await as(app, token).get('/users/me');
      expect(me.statusCode).toBe(200);
      expect(me.json()).toEqual(user);
    });

    it('returns 409 for a duplicate email, also with different case', async () => {
      await register({ email: 'a@x.y', name: 'A' });
      for (const email of ['a@x.y', 'A@X.Y', ' a@x.y ']) {
        const res = await register({ email, name: 'B' });
        expect(res.statusCode).toBe(409);
        expect(res.json()).toMatchObject({ error: 'Conflict' });
        errorShape(res.json());
      }
    });

    it('returns 409 for the seeded default user email', async () => {
      expect((await register({ email: DEFAULT_USER_EMAIL, name: 'X' })).statusCode).toBe(409);
    });

    it.each([
      ['missing email', { name: 'A' }],
      ['missing name', { email: 'a@x.y' }],
      ['blank name', { email: 'a@x.y', name: '   ' }],
      ['101-char name', { email: 'a@x.y', name: 'x'.repeat(101) }],
      ['empty email', { email: '', name: 'A' }],
      ['email over 300 characters', { email: `${'a'.repeat(300)}@x.y`, name: 'A' }],
      ['email over 254 characters after the schema check', { email: `${'a'.repeat(260)}@x.y`, name: 'A' }],
      ['email without @', { email: 'no-at', name: 'A' }],
      ['email without a dot in the domain', { email: 'a@b', name: 'A' }],
      ['email with spaces', { email: 'a b@c.d', name: 'A' }],
      ['non-string email', { email: 5, name: 'A' }],
      ['empty body', {}],
    ])('returns 400 for %s', async (_label, payload) => {
      const res = await register(payload);
      expect(res.statusCode).toBe(400);
      errorShape(res.json());
    });

    it('drops unknown properties instead of rejecting them (Fastify removeAdditional)', async () => {
      const res = await register({ email: 'a@x.y', name: 'A', admin: true });
      expect(res.statusCode).toBe(201);
      expect(res.json().user).not.toHaveProperty('admin');
    });
  });

  describe('POST /auth/login', () => {
    it('returns 200 with a token and user for the seeded user, also with upper case and spaces', async () => {
      for (const email of [DEFAULT_USER_EMAIL, '  EACAPS@Gmail.com ']) {
        const res = await login({ email });
        expect(res.statusCode).toBe(200);
        const body = res.json<Session>();
        expect(Object.keys(body).sort()).toEqual(['token', 'user']);
        expect(body.user).toMatchObject({ email: 'eacaps@gmail.com', name: 'eacaps' });
      }
    });

    it('lets a registered user log in and gets the same user id', async () => {
      const reg = await registerUser(app, 'a@x.y', 'A');
      const res = await login({ email: 'A@x.y' });
      expect(res.statusCode).toBe(200);
      expect(res.json<Session>().user).toEqual(reg.user);
    });

    it('returns 401 for an unknown email', async () => {
      const res = await login({ email: 'nobody@x.y' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Unauthorized', message: 'Invalid credentials' });
      expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it.each([
      ['missing email', { name: 'x' }],
      ['empty body', {}],
      ['empty email', { email: '' }],
    ])('returns 400 for %s', async (_label, payload) => {
      const res = await login(payload);
      expect(res.statusCode).toBe(400);
      errorShape(res.json());
    });

    it('coerces a numeric email to a string, so it is an unknown email (401), not a 400', async () => {
      expect((await login({ email: 1 })).statusCode).toBe(401);
    });

    it('returns 400 for a request without a body', async () => {
      const res = await app.inject({ method: 'POST', url: '/auth/login' });
      expect(res.statusCode).toBe(400);
    });

    it('issues a token whose sub is the user id', async () => {
      const { token, user } = (await login({ email: DEFAULT_USER_EMAIL })).json<Session>();
      expect(app.jwt.decode<{ sub: string }>(token)?.sub).toBe(user.id);
    });
  });

  describe('GET /users/me', () => {
    it('returns the current user', async () => {
      const session = await defaultUserToken(app);
      const res = await as(app, session.token).get('/users/me');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(session.user);
    });

    it('returns each user their own record', async () => {
      const bob = await registerUser(app, 'bob@x.y', 'Bob');
      expect((await as(app, bob.token).get('/users/me')).json()).toEqual(bob.user);
    });

    it('returns 401 without a token', async () => {
      const res = await app.inject({ method: 'GET', url: '/users/me' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Unauthorized' });
    });

    it('accepts a raw bearer header', async () => {
      const { token } = await defaultUserToken(app);
      const res = await app.inject({ method: 'GET', url: '/users/me', headers: bearer(token) });
      expect(res.statusCode).toBe(200);
    });
  });
});
