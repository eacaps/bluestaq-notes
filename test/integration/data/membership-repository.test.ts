import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../../../src/data/connection.js';
import { SqliteMembershipRepository } from '../../../src/data/membership-repository.js';
import { SqliteTeamRepository } from '../../../src/data/team-repository.js';
import { SqliteUserRepository } from '../../../src/data/user-repository.js';

describe('SqliteMembershipRepository', () => {
  let db: Db;
  let members: SqliteMembershipRepository;
  let teams: SqliteTeamRepository;
  let users: SqliteUserRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    members = new SqliteMembershipRepository(db);
    teams = new SqliteTeamRepository(db);
    users = new SqliteUserRepository(db);
  });
  afterEach(() => db.close());

  const team = (name = 'T') => teams.insert({ id: randomUUID(), name }).id;
  const user = (email: string, createdAt?: string, id: string = randomUUID()) => {
    users.insert({ id, email, name: email });
    if (createdAt) db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(createdAt, id);
    return id;
  };
  const count = () =>
    (db.prepare('SELECT COUNT(*) AS n FROM team_members').get() as { n: number }).n;

  it('add is idempotent and isMember reports hits and misses', () => {
    const t = team();
    const u = user('a@x.y');
    expect(members.isMember(t, u)).toBe(false);
    members.add(t, u);
    members.add(t, u);
    expect(members.isMember(t, u)).toBe(true);
    expect(count()).toBe(1);
    expect(members.isMember(t, user('b@x.y'))).toBe(false);
    expect(members.isMember(team('other'), u)).toBe(false);
  });

  it('remove deletes the membership and is idempotent', () => {
    const t = team();
    const [a, b] = [user('a@x.y'), user('b@x.y')];
    members.add(t, a);
    members.add(t, b);
    members.remove(t, a);
    members.remove(t, a);
    expect(members.isMember(t, a)).toBe(false);
    expect(members.isMember(t, b)).toBe(true);
    expect(() => members.remove(randomUUID(), randomUUID())).not.toThrow();
  });

  it('enforces foreign keys on add', () => {
    expect(() => members.add(randomUUID(), user('a@x.y'))).toThrow();
    expect(() => members.add(team(), randomUUID())).toThrow();
  });

  describe('findMemberTeamIds', () => {
    it('returns the subset of the given ids the user belongs to', () => {
      const [t1, t2, t3] = [team('1'), team('2'), team('3')];
      const [a, b] = [user('a@x.y'), user('b@x.y')];
      members.add(t1, a);
      members.add(t3, a);
      members.add(t2, b);
      expect(members.findMemberTeamIds(a, [t1, t2, t3]).sort()).toEqual([t1, t3].sort());
      expect(members.findMemberTeamIds(b, [t1, t3])).toEqual([]);
    });

    it('returns an empty list for empty input and ignores unknown ids', () => {
      const t = team();
      const a = user('a@x.y');
      members.add(t, a);
      expect(members.findMemberTeamIds(a, [])).toEqual([]);
      expect(members.findMemberTeamIds(a, [randomUUID(), t])).toEqual([t]);
      expect(members.findMemberTeamIds(randomUUID(), [t])).toEqual([]);
    });
  });

  describe('listMembers', () => {
    it('orders by created_at then id, with total and limit/offset', () => {
      const t = team();
      const c = user('c@x.y', '2024-01-03T00:00:00.000Z');
      const a = user('a@x.y', '2024-01-01T00:00:00.000Z');
      const b2 = user('b2@x.y', '2024-01-02T00:00:00.000Z', 'bbbbbbbb-0000-0000-0000-000000000002');
      const b1 = user('b1@x.y', '2024-01-02T00:00:00.000Z', 'bbbbbbbb-0000-0000-0000-000000000001');
      for (const u of [c, a, b2, b1]) members.add(t, u);
      expect(members.listMembers(t, 10, 0).items.map((u) => u.email)).toEqual([
        'a@x.y',
        'b1@x.y',
        'b2@x.y',
        'c@x.y',
      ]);
      const page = members.listMembers(t, 2, 1);
      expect(page.items.map((u) => u.email)).toEqual(['b1@x.y', 'b2@x.y']);
      expect(page.total).toBe(4);
      expect(members.listMembers(t, 10, 10)).toEqual({ items: [], total: 4 });
    });

    it('returns full user entities only for that team, and an empty page for an empty team', () => {
      const [t1, t2] = [team('1'), team('2')];
      const a = user('a@x.y');
      members.add(t1, a);
      expect(members.listMembers(t1, 10, 0).items).toEqual([users.findById(a)]);
      expect(members.listMembers(t2, 10, 0)).toEqual({ items: [], total: 0 });
    });
  });

  describe('cascade', () => {
    it('deleting a team removes its memberships', () => {
      const t = team();
      members.add(t, user('a@x.y'));
      db.prepare('DELETE FROM teams WHERE id = ?').run(t);
      expect(count()).toBe(0);
    });

    it('deleting a user removes their memberships', () => {
      const t = team();
      const [a, b] = [user('a@x.y'), user('b@x.y')];
      members.add(t, a);
      members.add(t, b);
      db.prepare('DELETE FROM users WHERE id = ?').run(a);
      expect(members.listMembers(t, 10, 0).items.map((u) => u.id)).toEqual([b]);
    });
  });
});
