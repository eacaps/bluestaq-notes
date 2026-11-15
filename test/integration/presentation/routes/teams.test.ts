import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  as,
  buildTestApp,
  createTeam,
  defaultUserToken,
  registerUser,
  type Session,
} from '../../../helpers/build-test-app.js';

describe('/teams', () => {
  let app: FastifyInstance;
  let me: Session;
  let api: ReturnType<typeof as>;

  beforeEach(async () => {
    app = await buildTestApp();
    me = await defaultUserToken(app);
    api = as(app, me.token);
  });
  afterEach(() => app.close());

  const post = (payload: unknown) => api.post('/teams', payload);

  it('POST creates a team with a trimmed name', async () => {
    const res = await post({ name: '  Core  ' });
    expect(res.statusCode).toBe(201);
    const team = res.json();
    expect(Object.keys(team).sort()).toEqual(['created_at', 'id', 'name']);
    expect(team.name).toBe('Core');
  });

  it('POST makes the creator the only member', async () => {
    const team = (await post({ name: 'Core' })).json();
    const members = (await api.get(`/teams/${team.id}/members`)).json();
    expect(members.total).toBe(1);
    expect(members.items.map((u: { id: string }) => u.id)).toEqual([me.user.id]);
  });

  it.each([
    ['blank name', { name: '   ' }],
    ['missing name', {}],
    ['101-char name', { name: 'x'.repeat(101) }],
  ])('POST rejects %s with 400', async (_label, payload) => {
    const res = await post(payload);
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json()).sort()).toEqual(['error', 'message']);
  });

  it('POST silently drops unknown properties (Fastify default removeAdditional)', async () => {
    const res = await post({ name: 'ok', extra: 1 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).not.toHaveProperty('extra');
  });

  it('GET list returns the envelope, oldest first', async () => {
    const a = await createTeam(app, 'a', me.token);
    const b = await createTeam(app, 'b', me.token);
    const res = await api.get('/teams?limit=5&offset=0');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ total: 2, limit: 5, offset: 0 });
    expect(body.items.map((t: { id: string }) => t.id).sort()).toEqual([a.id, b.id].sort());
    const defaults = (await api.get('/teams')).json();
    expect(defaults).toMatchObject({ limit: 20, offset: 0 });
  });

  it('GET list returns only the teams the caller belongs to', async () => {
    const bob = await registerUser(app, 'bob@x.y', 'Bob');
    const mine = await createTeam(app, 'mine', me.token);
    await createTeam(app, 'bobs', bob.token);
    const mineList = (await api.get('/teams')).json();
    expect(mineList.items.map((t: { id: string }) => t.id)).toEqual([mine.id]);
    expect(mineList.total).toBe(1);
    const carol = await registerUser(app, 'carol@x.y', 'Carol');
    expect((await as(app, carol.token).get('/teams')).json()).toMatchObject({ items: [], total: 0 });
  });

  it('GET list pages through the caller teams', async () => {
    for (const n of ['a', 'b', 'c']) await createTeam(app, n, me.token);
    const page = (await api.get('/teams?limit=2&offset=2')).json();
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(3);
  });

  it.each(['limit=0', 'limit=101', 'offset=-1', 'limit=abc'])('GET list rejects %s', async (qs) => {
    const res = await api.get(`/teams?${qs}`);
    expect(res.statusCode).toBe(400);
  });

  it('GET by id: 200, 400, 404', async () => {
    const team = await createTeam(app, 'a', me.token);
    const ok = await api.get(`/teams/${team.id}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual(team);
    expect((await api.get('/teams/not-a-uuid')).statusCode).toBe(400);
    const missing = await api.get(`/teams/${randomUUID()}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: 'Not Found' });
  });

  it('GET by id returns 404 to a non-member, the same as for an unknown team', async () => {
    const bob = await registerUser(app, 'bob@x.y', 'Bob');
    const team = await createTeam(app, 'a', me.token);
    const res = await as(app, bob.token).get(`/teams/${team.id}`);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not Found', message: `Team ${team.id} not found` });
  });
});
