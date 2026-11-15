import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  as,
  buildTestApp,
  createNote,
  createTeam,
  defaultUserToken,
  registerUser,
} from '../../../helpers/build-test-app.js';

describe('/notes', () => {
  let app: FastifyInstance;
  let token: string;
  let api: ReturnType<typeof as>;
  beforeEach(async () => {
    app = await buildTestApp();
    token = (await defaultUserToken(app)).token;
    api = as(app, token);
  });
  afterEach(() => app.close());

  const post = (payload: unknown) => api.post('/notes', payload);
  const patch = (id: string, payload: unknown) => api.patch(`/notes/${id}`, payload);
  const expectErrorShape = (body: unknown) =>
    expect(Object.keys(body as object).sort()).toEqual(['error', 'message']);

  describe('POST', () => {
    it('creates a note with the full shape and trimmed title', async () => {
      const res = await post({ title: '  Hi ', body: 'b' });
      expect(res.statusCode).toBe(201);
      const note = res.json();
      expect(Object.keys(note).sort()).toEqual(
        ['body', 'created_at', 'id', 'owner_id', 'team_ids', 'title', 'updated_at'],
      );
      expect(note).toMatchObject({ title: 'Hi', body: 'b', team_ids: [] });
      const user = (await createNote(app, { title: 'x', body: '' }, token)).owner_id;
      expect(note.owner_id).toBe(user);
    });

    it.each([
      ['empty object', {}],
      ['blank title', { title: '   ', body: '' }],
      ['missing body', { title: 't' }],
      ['bad uuid in team_ids', { title: 't', body: '', team_ids: ['x'] }],
      [
        'more than 50 team_ids',
        { title: 't', body: '', team_ids: Array.from({ length: 51 }, () => randomUUID()) },
      ],
    ])('rejects %s with 400', async (_label, payload) => {
      const res = await post(payload);
      expect(res.statusCode).toBe(400);
      expectErrorShape(res.json());
    });

    it('silently drops unknown properties (Fastify default removeAdditional)', async () => {
      const res = await post({ title: 't', body: '', extra: 1 });
      expect(res.statusCode).toBe(201);
      expect(res.json()).not.toHaveProperty('extra');
    });

    it('rejects an unknown team id with a fixed message that does not echo it', async () => {
      const id = randomUUID();
      const res = await post({ title: 't', body: '', team_ids: [id] });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: 'Bad Request',
        message: 'team_ids must be existing teams that you belong to',
      });
      expect(res.body).not.toContain(id);
    });

    it('rejects a team the caller does not belong to with the same 400', async () => {
      const bob = await registerUser(app, 'bob@x.y', 'Bob');
      const bobTeam = await createTeam(app, 'bobs', bob.token);
      const res = await post({ title: 't', body: '', team_ids: [bobTeam.id] });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe('team_ids must be existing teams that you belong to');
      expect((await api.get('/notes')).json().total).toBe(0);
    });

    it('accepts a team the caller belongs to', async () => {
      const team = await createTeam(app, 'mine', token);
      const res = await post({ title: 't', body: '', team_ids: [team.id] });
      expect(res.statusCode).toBe(201);
      expect(res.json().team_ids).toEqual([team.id]);
    });
  });

  describe('GET list', () => {
    it('returns the envelope with defaults', async () => {
      await createNote(app, { title: 't', body: '' }, token);
      const res = await api.get('/notes');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ total: 1, limit: 20, offset: 0 });
      expect(res.json().items).toHaveLength(1);
    });

    it.each(['limit=0', 'limit=101', 'offset=-1', 'limit=1.5', 'team=not-a-uuid'])(
      'rejects %s with 400',
      async (qs) => {
        const res = await api.get(`/notes?${qs}`);
        expect(res.statusCode).toBe(400);
        expectErrorShape(res.json());
      },
    );
  });

  describe('GET list visibility', () => {
    it('lists only notes the caller can read', async () => {
      const bob = await registerUser(app, 'bob@x.y', 'Bob');
      await createNote(app, { title: 'mine', body: '' }, token);
      await createNote(app, { title: 'bobs', body: '' }, bob.token);
      const res = await api.get('/notes');
      expect(res.json()).toMatchObject({ total: 1 });
      expect(res.json().items.map((n: { title: string }) => n.title)).toEqual(['mine']);
    });

    it('returns an empty page for a team filter the caller is not in', async () => {
      const bob = await registerUser(app, 'bob@x.y', 'Bob');
      const bobTeam = await createTeam(app, 'bobs', bob.token);
      await createNote(app, { title: 'shared', body: '', team_ids: [bobTeam.id] }, bob.token);
      const res = await api.get(`/notes?team=${bobTeam.id}`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ items: [], total: 0 });
    });
  });

  describe('GET by id', () => {
    it('round-trips the created note', async () => {
      const created = await createNote(app, { title: 't', body: 'b' }, token);
      const res = await api.get(`/notes/${created.id}`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(created);
    });

    it('404 for a note the caller cannot read, with the same body as an unknown id', async () => {
      const bob = await registerUser(app, 'bob@x.y', 'Bob');
      const created = await createNote(app, { title: 't', body: 'b' }, bob.token);
      const res = await api.get(`/notes/${created.id}`);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Not Found', message: `Note ${created.id} not found` });
    });

    it('400 for a non-uuid id, 404 for an unknown id', async () => {
      expect((await api.get('/notes/abc')).statusCode).toBe(400);
      const res = await api.get(`/notes/${randomUUID()}`);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'Not Found' });
      expectErrorShape(res.json());
    });
  });

  describe('PATCH', () => {
    it('updates only the title and bumps updated_at', async () => {
      const created = await createNote(app, { title: 'old', body: 'keep' }, token);
      const res = await patch(created.id, { title: 'new' });
      expect(res.statusCode).toBe(200);
      const note = res.json();
      expect(note).toMatchObject({ title: 'new', body: 'keep', created_at: created.created_at });
      expect(note.updated_at >= created.updated_at).toBe(true);
    });

    it('replaces team_ids', async () => {
      const t1 = await createTeam(app, 'a', token);
      const t2 = await createTeam(app, 'b', token);
      const created = await createNote(app, { title: 't', body: '', team_ids: [t1.id] }, token);
      const res = await patch(created.id, { team_ids: [t2.id] });
      expect(res.json().team_ids).toEqual([t2.id]);
    });

    it.each([
      ['empty body', {}],
      ['blank title', { title: ' ' }],
      ['unknown team_ids', { team_ids: [randomUUID()] }],
    ])('rejects %s with 400', async (_label, payload) => {
      const created = await createNote(app, { title: 't', body: '' }, token);
      const res = await patch(created.id, payload);
      expect(res.statusCode).toBe(400);
      expectErrorShape(res.json());
    });

    it('404 when the caller cannot read the note, and the note is unchanged', async () => {
      const bob = await registerUser(app, 'bob@x.y', 'Bob');
      const created = await createNote(app, { title: 't', body: 'b' }, bob.token);
      const res = await patch(created.id, { title: 'hacked' });
      expect(res.statusCode).toBe(404);
      expectErrorShape(res.json());
      expect((await as(app, bob.token).get(`/notes/${created.id}`)).json().title).toBe('t');
    });

    it('rejects team_ids with a team the caller is not in using 400', async () => {
      const bob = await registerUser(app, 'bob@x.y', 'Bob');
      const bobTeam = await createTeam(app, 'bobs', bob.token);
      const created = await createNote(app, { title: 't', body: '' }, token);
      const res = await patch(created.id, { team_ids: [bobTeam.id] });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe('team_ids must be existing teams that you belong to');
    });

    it('lets a team member edit a team note without changing its owner', async () => {
      const bob = await registerUser(app, 'bob@x.y', 'Bob');
      const team = await createTeam(app, 'T', token);
      await api.put(`/teams/${team.id}/members/${bob.user.id}`);
      const created = await createNote(app, { title: 't', body: '', team_ids: [team.id] }, token);
      const res = await as(app, bob.token).patch(`/notes/${created.id}`, { title: 'by bob' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ title: 'by bob', owner_id: created.owner_id });
    });

    it('ignores unknown properties alongside valid ones', async () => {
      const created = await createNote(app, { title: 't', body: '' }, token);
      const res = await patch(created.id, { title: 'new', extra: 1 });
      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty('extra');
    });

    it('404 for an unknown id, 400 for a non-uuid id', async () => {
      expect((await patch(randomUUID(), { title: 'x' })).statusCode).toBe(404);
      expect((await patch('abc', { title: 'x' })).statusCode).toBe(400);
    });
  });
});
