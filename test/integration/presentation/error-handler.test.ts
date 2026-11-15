import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../../src/domain/errors.js';
import { registerErrorHandler } from '../../../src/presentation/error-handler.js';
import { as, buildTestApp, defaultUserToken } from '../../helpers/build-test-app.js';

describe('error handler', () => {
  let app: FastifyInstance;
  afterEach(() => app.close());

  async function build() {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    app.get('/not-found', () => {
      throw new NotFoundError('nf');
    });
    app.get('/invalid', () => {
      throw new ValidationError('bad');
    });
    app.get('/forbidden', () => {
      throw new ForbiddenError('nope');
    });
    app.get('/unauthorized', () => {
      throw new UnauthorizedError('who are you');
    });
    app.get('/conflict', () => {
      throw new ConflictError('taken');
    });
    app.get('/teapot', () => {
      throw Object.assign(new Error('short and stout'), { statusCode: 418 });
    });
    app.get('/boom', () => {
      throw new Error('secret internals');
    });
    app.get('/schema', { schema: { querystring: { type: 'object', required: ['x'] } } }, () => 'ok');
  }

  it.each([
    ['/not-found', 404, 'Not Found', 'nf'],
    ['/invalid', 400, 'Bad Request', 'bad'],
    ['/forbidden', 403, 'Forbidden', 'nope'],
    ['/unauthorized', 401, 'Unauthorized', 'who are you'],
    ['/conflict', 409, 'Conflict', 'taken'],
    ['/teapot', 418, "I'm a Teapot", 'short and stout'],
  ])('maps %s to %i', async (url, status, error, message) => {
    await build();
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error, message });
  });

  it('hides the message of unexpected errors', async () => {
    await build();
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal Server Error', message: 'Unexpected error' });
    expect(res.body).not.toContain('secret');
  });

  it('maps schema validation failures to 400', async () => {
    await build();
    const res = await app.inject({ method: 'GET', url: '/schema' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Bad Request' });
  });

  it('sends WWW-Authenticate: Bearer with a 401', async () => {
    await build();
    const res = await app.inject({ method: 'GET', url: '/unauthorized' });
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('returns a 404 body for unknown routes on the real app when authenticated', async () => {
    app = await buildTestApp();
    const { token } = await defaultUserToken(app);
    const res = await as(app, token).get('/nope?x=1');
    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string; message: string }>();
    expect(body.error).toBe('Not Found');
    expect(body.message).toContain('GET');
    expect(body.message).toContain('/nope?x=1');
  });

  it('returns 401, not 404, for unknown routes without a token (default-deny)', async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Unauthorized' });
  });
});
