import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../../../src/data/connection.js';
import { SqliteMembershipRepository } from '../../../src/data/membership-repository.js';
import { SqliteNoteRepository } from '../../../src/data/note-repository.js';
import { AccessService } from '../../../src/services/access-service.js';
import { SqliteTeamRepository } from '../../../src/data/team-repository.js';
import { SqliteUserRepository } from '../../../src/data/user-repository.js';

const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('SqliteNoteRepository', () => {
  let db: Db;
  let notes: SqliteNoteRepository;
  let teams: SqliteTeamRepository;
  let memberships: SqliteMembershipRepository;
  let users: SqliteUserRepository;
  let ownerId: string;

  beforeEach(() => {
    db = openDatabase(':memory:');
    notes = new SqliteNoteRepository(db);
    teams = new SqliteTeamRepository(db);
    memberships = new SqliteMembershipRepository(db);
    users = new SqliteUserRepository(db);
    ownerId = users.insert({ id: randomUUID(), email: 'o@x.y', name: 'O' }).id;
  });
  afterEach(() => db.close());

  const team = (name = 'T') => teams.insert({ id: randomUUID(), name }).id;
  const add = (title: string, body = '', teamIds: string[] = [], id: string = randomUUID()) =>
    notes.insert({ id, ownerId, title, body, teamIds });
  const setCreated = (id: string, at: string) =>
    db.prepare('UPDATE notes SET created_at = ? WHERE id = ?').run(at, id);
  const noteTeamRows = (noteId: string) =>
    db.prepare('SELECT team_id FROM note_teams WHERE note_id = ?').all(noteId);
  const q = (extra: { q?: string; teamId?: string; limit?: number; offset?: number; viewerId?: string }) =>
    notes.list({ limit: 100, offset: 0, viewerId: ownerId, ...extra });
  const user = (email: string) => users.insert({ id: randomUUID(), email, name: email }).id;
  const addFor = (owner: string, title: string, teamIds: string[] = []) =>
    notes.insert({ id: randomUUID(), ownerId: owner, title, body: '', teamIds });

  it('insert returns team ids in link order and DB timestamps', () => {
    const [t1, t2, t3] = [team('1'), team('2'), team('3')];
    const note = add('t', 'b', [t3, t1, t2]);
    expect(note.teamIds).toEqual([t3, t1, t2]);
    expect(note.createdAt).toMatch(TS);
    expect(note.updatedAt).toMatch(TS);
  });

  it('update replaces fields and links, bumps updated_at, keeps created_at', async () => {
    const t1 = team();
    const t2 = team();
    const before = add('old', 'old', [t1]);
    await new Promise((r) => setTimeout(r, 10));
    const after = notes.update({ id: before.id, ownerId, title: 'new', body: 'nb', teamIds: [t2] });
    expect(after).toMatchObject({ title: 'new', body: 'nb', teamIds: [t2], createdAt: before.createdAt });
    expect(after.updatedAt > before.updatedAt).toBe(true);
  });

  it('update bumps updated_at when only team ids change', async () => {
    const before = add('t', 'b');
    await new Promise((r) => setTimeout(r, 10));
    const after = notes.update({ id: before.id, ownerId, title: 't', body: 'b', teamIds: [team()] });
    expect(after.updatedAt > before.updatedAt).toBe(true);
  });

  it('findById returns undefined for an unknown id', () => {
    expect(notes.findById(randomUUID())).toBeUndefined();
  });

  describe('q filter', () => {
    it('matches title and body case-insensitively', () => {
      add('Hello World', 'x');
      add('other', 'say HELLO');
      add('nothing', 'here');
      expect(q({ q: 'hello' }).total).toBe(2);
    });

    it('treats % and _ literally', () => {
      add('100% done');
      add('plain');
      add('a_b');
      add('aXb');
      expect(q({ q: '100%' }).items.map((n) => n.title)).toEqual(['100% done']);
      expect(q({ q: 'a_b' }).items.map((n) => n.title)).toEqual(['a_b']);
      expect(q({ q: '%' }).total).toBe(1);
    });

    it('treats a backslash literally', () => {
      add('a\\b');
      add('ab');
      expect(q({ q: '\\' }).items.map((n) => n.title)).toEqual(['a\\b']);
    });
  });

  it('filters by team and combines with q using AND', () => {
    const t = team();
    add('apple', '', [t]);
    add('banana', '', [t]);
    add('apple pie');
    expect(q({ teamId: t }).total).toBe(2);
    expect(q({ teamId: t, q: 'apple' }).items.map((n) => n.title)).toEqual(['apple']);
  });

  it('paginates with total independent of limit and offset', () => {
    for (let i = 0; i < 5; i++) add(`n${i}`);
    expect(q({ limit: 2 })).toMatchObject({ total: 5 });
    expect(q({ limit: 2 }).items).toHaveLength(2);
    expect(q({ limit: 2, offset: 4 }).items).toHaveLength(1);
    expect(q({ offset: 10 })).toEqual({ items: [], total: 5 });
  });

  it('orders newest first with id ascending as tie-break', () => {
    const a = add('a', '', [], 'aaaaaaaa-0000-0000-0000-000000000000');
    const b = add('b', '', [], 'bbbbbbbb-0000-0000-0000-000000000000');
    const c = add('c', '', [], 'cccccccc-0000-0000-0000-000000000000');
    const d = add('d', '', [], 'dddddddd-0000-0000-0000-000000000000');
    setCreated(a.id, '2024-01-01T00:00:00.000Z');
    setCreated(b.id, '2024-01-02T00:00:00.000Z');
    setCreated(c.id, '2024-01-03T00:00:00.000Z');
    setCreated(d.id, '2024-01-02T00:00:00.000Z');
    expect(q({}).items.map((n) => n.title)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('attaches the right team ids to each note on a page', () => {
    const [t1, t2, t3] = [team('1'), team('2'), team('3')];
    const n1 = add('n1', '', [t1, t2]);
    const n2 = add('n2', '', [t3]);
    const n3 = add('n3');
    const byId = new Map(q({}).items.map((n) => [n.id, n.teamIds]));
    expect(byId.get(n1.id)).toEqual([t1, t2]);
    expect(byId.get(n2.id)).toEqual([t3]);
    expect(byId.get(n3.id)).toEqual([]);
  });

  it('cascades: deleting a team or a note removes links', () => {
    const t1 = team();
    const t2 = team();
    const note = add('n', '', [t1, t2]);
    db.prepare('DELETE FROM teams WHERE id = ?').run(t1);
    expect(notes.findById(note.id)?.teamIds).toEqual([t2]);
    db.prepare('DELETE FROM notes WHERE id = ?').run(note.id);
    expect(noteTeamRows(note.id)).toEqual([]);
  });

  it('enforces foreign keys', () => {
    expect(() => add('n', '', [randomUUID()])).toThrow();
    expect(() =>
      notes.insert({ id: randomUUID(), ownerId: randomUUID(), title: 't', body: '', teamIds: [] }),
    ).toThrow();
  });

  describe('visibility', () => {
    it('shows the owner their own notes, team members the team notes, and strangers nothing', () => {
      const bob = user('bob@x.y');
      const carol = user('carol@x.y');
      const t = team();
      memberships.add(t, bob);
      add('private');
      add('shared', '', [t]);
      expect(q({}).items.map((n) => n.title).sort()).toEqual(['private', 'shared']);
      expect(q({ viewerId: bob }).items.map((n) => n.title)).toEqual(['shared']);
      expect(q({ viewerId: carol })).toEqual({ items: [], total: 0 });
    });

    it('lists a note in two teams once for a user who belongs to both', () => {
      const bob = user('bob@x.y');
      const [t1, t2] = [team('1'), team('2')];
      memberships.add(t1, bob);
      memberships.add(t2, bob);
      add('both', '', [t1, t2]);
      const page = q({ viewerId: bob });
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(1);
    });

    it('counts only visible notes in total, independent of paging', () => {
      const bob = user('bob@x.y');
      const t = team();
      memberships.add(t, bob);
      for (let i = 0; i < 3; i++) add(`s${i}`, '', [t]);
      for (let i = 0; i < 4; i++) add(`p${i}`);
      addFor(bob, 'bobs');
      expect(q({ viewerId: bob, limit: 2 })).toMatchObject({ total: 4 });
      expect(q({ viewerId: bob, limit: 2 }).items).toHaveLength(2);
    });

    it('combines q and team filters with visibility by AND', () => {
      const bob = user('bob@x.y');
      const t = team();
      memberships.add(t, bob);
      add('apple shared', '', [t]);
      add('apple private');
      expect(q({ viewerId: bob, q: 'apple' }).items.map((n) => n.title)).toEqual(['apple shared']);
      expect(q({ viewerId: bob, q: 'apple', teamId: t }).total).toBe(1);
      expect(q({ viewerId: bob, q: 'private' }).total).toBe(0);
    });

    it('returns an empty page when filtering by a team the viewer is not in', () => {
      const bob = user('bob@x.y');
      const t = team();
      add('shared', '', [t]);
      expect(q({ viewerId: bob, teamId: t })).toEqual({ items: [], total: 0 });
    });

    it('loses visibility when the membership is removed, and the owner keeps theirs', () => {
      const bob = user('bob@x.y');
      const t = team();
      memberships.add(t, bob);
      add('shared', '', [t]);
      addFor(bob, 'bobs', [t]);
      expect(q({ viewerId: bob }).total).toBe(2);
      memberships.remove(t, bob);
      expect(q({ viewerId: bob }).items.map((n) => n.title)).toEqual(['bobs']);
    });

    it('matches AccessService.canRead for a matrix of users and notes', () => {
      const bob = user('bob@x.y');
      const carol = user('carol@x.y');
      const [t1, t2] = [team('1'), team('2')];
      memberships.add(t1, bob);
      memberships.add(t2, carol);
      const access = new AccessService(memberships);
      const created = [add('private'), add('t1', '', [t1]), add('t2', '', [t2]), add('both', '', [t1, t2]), addFor(bob, 'bobs', [t2])];
      for (const viewerId of [ownerId, bob, carol]) {
        const viewer = users.findById(viewerId)!;
        const listed = new Set(q({ viewerId }).items.map((n) => n.id));
        for (const note of created) {
          expect(listed.has(note.id), `${viewer.email} / ${note.title}`).toBe(access.canRead(viewer, note));
        }
      }
    });
  });
});
