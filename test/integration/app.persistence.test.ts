import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import {
  TEST_JWT_SECRET,
  as,
  createNote,
  createTeam,
  defaultUserToken,
  type NoteBody,
} from '../helpers/build-test-app.js';

describe('persistence', () => {
  let dir: string;
  const apps: FastifyInstance[] = [];
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'notes-test-'));
  });
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close().catch(() => undefined)));
    await rm(dir, { recursive: true, force: true });
  });

  const open = async (path: string) => {
    const app = await buildApp({ dbPath: path, jwtSecret: TEST_JWT_SECRET, jwtExpiresIn: '1h', logger: false });
    apps.push(app);
    await app.ready();
    return app;
  };

  it('keeps data across a restart and does not duplicate the seeded user', async () => {
    const path = join(dir, 'notes.db');
    const first = await open(path);
    const login1 = await defaultUserToken(first);
    const team = await createTeam(first, 'T', login1.token);
    const note = await createNote(first, { title: 'kept', body: 'b', team_ids: [team.id] }, login1.token);
    await first.close();
    const second = await open(path);
    const login2 = await defaultUserToken(second);
    expect(login2.user).toEqual(login1.user);
    // Same secret: the token from before the restart still verifies.
    for (const token of [login1.token, login2.token]) {
      const api = as(second, token);
      const res = await api.get(`/notes/${note.id}`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(note);
      expect((await api.get(`/teams/${team.id}`)).json()).toEqual(team);
    }
    const api = as(second, login2.token);
    const another = await createNote(second, { title: 'x', body: '' }, login2.token);
    expect(another.owner_id).toBe(note.owner_id);
    expect((await api.get('/notes')).json<{ total: number }>().total).toBe(2);
  });

  it('keeps registered users and memberships across a restart', async () => {
    const path = join(dir, 'notes.db');
    const first = await open(path);
    const reg = await first.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'bob@x.y', name: 'Bob' },
    });
    const bob = reg.json<{ user: { id: string } }>().user;
    const owner = await defaultUserToken(first);
    const team = await createTeam(first, 'T', owner.token);
    await as(first, owner.token).put(`/teams/${team.id}/members/${bob.id}`);
    await first.close();
    const second = await open(path);
    const login = await second.inject({ method: 'POST', url: '/auth/login', payload: { email: 'bob@x.y' } });
    expect(login.statusCode).toBe(200);
    const res = await as(second, login.json<{ token: string }>().token).get(`/teams/${team.id}`);
    expect(res.statusCode).toBe(200);
  });

  it('creates a missing nested directory for the database file', async () => {
    const path = join(dir, 'a', 'b', 'notes.db');
    await open(path);
    expect(existsSync(path)).toBe(true);
  });
});

export type { NoteBody };
