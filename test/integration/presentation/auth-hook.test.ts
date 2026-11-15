import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  as,
  bearer,
  buildTestApp,
  defaultUserToken,
  type Session,
} from '../../helpers/build-test-app.js';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('authentication hook (default-deny)', () => {
  let app: FastifyInstance;
  let session: Session;

  beforeEach(async () => {
    app = await buildTestApp();
    session = await defaultUserToken(app);
  });
  afterEach(() => app.close());

  const send = (method: Method, url: string, headers: Record<string, string> = {}, payload?: unknown) =>
    app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });
  const expect401 = (res: { statusCode: number; json: () => unknown; headers: Record<string, unknown> }) => {
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Unauthorized' });
    expect(Object.keys(res.json() as object).sort()).toEqual(['error', 'message']);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  };

  describe('public routes', () => {
    it('POST /auth/register and /auth/login need no token', async () => {
      expect((await send('POST', '/auth/register', {}, { email: 'a@x.y', name: 'A' })).statusCode).toBe(201);
      expect((await send('POST', '/auth/login', {}, { email: 'a@x.y' })).statusCode).toBe(200);
    });

    it('serves /docs/json without a token', async () => {
      const res = await send('GET', '/docs/json');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ openapi: '3.0.3' });
    });

    it('serves the Swagger UI page without a token', async () => {
      const res = await send('GET', '/docs');
      expect([200, 302]).toContain(res.statusCode);
      const page = await send('GET', '/docs/');
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-type']).toContain('text/html');
    });

    it('ignores a bad token on a public route', async () => {
      const res = await send('POST', '/auth/login', { authorization: 'Bearer garbage' }, { email: 'a@x.y' });
      expect(res.statusCode).toBe(401); // unknown email, not a token failure
      expect(res.json()).toMatchObject({ message: 'Invalid credentials' });
    });
  });

  describe('protected routes without a token', () => {
    const id = randomUUID();
    const other = randomUUID();
    it.each<[Method, string]>([
      ['GET', '/notes'],
      ['POST', '/notes'],
      ['GET', `/notes/${id}`],
      ['PATCH', `/notes/${id}`],
      ['GET', '/teams'],
      ['POST', '/teams'],
      ['GET', `/teams/${id}`],
      ['GET', `/teams/${id}/members`],
      ['PUT', `/teams/${id}/members/${other}`],
      ['DELETE', `/teams/${id}/members/${other}`],
      ['GET', '/users/me'],
    ])('%s %s returns 401', async (method, url) => {
      expect401(await send(method, url));
    });
  });

  describe('invalid credentials on a protected route', () => {
    const url = '/users/me';
    const unsigned = () =>
      `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: session.user.id })}.`;

    it.each([
      ['a Basic scheme', () => 'Basic xyz'],
      ['Bearer with no token', () => 'Bearer'],
      ['Bearer with a trailing space only', () => 'Bearer '],
      ['Bearer with two tokens', () => 'Bearer a b'],
      ['a garbage token', () => 'Bearer not.a.jwt'],
      ['an unsigned alg:none token', () => `Bearer ${unsigned()}`],
      ['a token with a tampered payload', () => {
        const [h, , s] = session.token.split('.');
        return `Bearer ${h}.${b64url({ sub: randomUUID() })}.${s}`;
      }],
    ])('rejects %s', async (_label, header) => {
      expect401(await send('GET', url, { authorization: header() }));
    });

    it('rejects an empty Authorization header', async () => {
      expect401(await send('GET', url, { authorization: '' }));
    });

    it('rejects a token signed with another secret', async () => {
      const other = await buildTestApp({ jwtSecret: 'other' });
      try {
        const foreign = (await defaultUserToken(other)).token;
        expect401(await send('GET', url, bearer(foreign)));
        // Same user id in both apps? No: ids are random, so also assert via a forged sub.
        const forged = other.jwt.sign({ sub: session.user.id });
        expect401(await send('GET', url, bearer(forged)));
      } finally {
        await other.close();
      }
    });

    it('rejects an expired token', async () => {
      const expired = app.jwt.sign({ sub: session.user.id, exp: Math.floor(Date.now() / 1000) - 60 });
      expect401(await send('GET', url, bearer(expired)));
    });

    it.each([
      ['no sub', () => ({})],
      ['a numeric sub', () => ({ sub: 5 })],
      ['an object sub', () => ({ sub: { id: 'x' } })],
    ])('rejects a validly signed token with %s', async (_label, claims) => {
      const token = app.jwt.sign(claims() as { sub?: string });
      expect401(await send('GET', url, bearer(token)));
    });

    it('rejects a validly signed token for a user id that does not exist', async () => {
      const token = app.jwt.sign({ sub: randomUUID() });
      const res = await send('GET', url, bearer(token));
      expect401(res);
      expect(res.json()).toMatchObject({ message: 'Invalid or expired token' });
    });

    it('rejects a token signed with a different algorithm', async () => {
      const hs512 = app.jwt.sign({ sub: session.user.id }, { algorithm: 'HS512' });
      expect401(await send('GET', url, bearer(hs512)));
    });
  });

  describe('ordering', () => {
    it('answers 401 before body validation', async () => {
      expect401(await send('POST', '/notes', {}, { not: 'valid' }));
      expect401(await send('POST', '/teams', {}, {}));
    });

    it('answers 401 before routing for an unknown route, and 404 with a token', async () => {
      expect401(await send('GET', '/nope'));
      expect((await as(app, session.token).get('/nope')).statusCode).toBe(404);
    });

    it('answers 401 before parameter validation', async () => {
      expect401(await send('GET', '/notes/not-a-uuid'));
    });

    it('runs validation after authentication succeeds', async () => {
      expect((await as(app, session.token).post('/notes', {})).statusCode).toBe(400);
    });
  });

  describe('accepted header forms', () => {
    it('accepts a lower-case or upper-case scheme', async () => {
      for (const scheme of ['bearer', 'BEARER', 'Bearer']) {
        const res = await send('GET', '/users/me', { authorization: `${scheme} ${session.token}` });
        expect(res.statusCode).toBe(200);
      }
    });
  });

  describe('token lifetime', () => {
    it('honors jwtExpiresIn', async () => {
      const short = await buildTestApp({ jwtExpiresIn: 1 });
      const long = await buildTestApp({ jwtExpiresIn: '2h' });
      try {
        const a = app.jwt.decode<{ iat: number; exp: number }>((await defaultUserToken(short)).token)!;
        const b = long.jwt.decode<{ iat: number; exp: number }>((await defaultUserToken(long)).token)!;
        expect(a.exp - a.iat).toBe(1);
        expect(b.exp - b.iat).toBe(7200);
      } finally {
        await short.close();
        await long.close();
      }
    });

    it('issues tokens that carry the HS256 algorithm', () => {
      const header = JSON.parse(Buffer.from(session.token.split('.')[0]!, 'base64url').toString());
      expect(header).toMatchObject({ alg: 'HS256' });
    });
  });
});
