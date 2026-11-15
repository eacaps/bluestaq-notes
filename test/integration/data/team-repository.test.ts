import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../../../src/data/connection.js';
import { SqliteMembershipRepository } from '../../../src/data/membership-repository.js';
import { SqliteTeamRepository } from '../../../src/data/team-repository.js';
import { SqliteUserRepository } from '../../../src/data/user-repository.js';

describe('SqliteTeamRepository', () => {
  let db: Db;
  let teams: SqliteTeamRepository;
  let memberships: SqliteMembershipRepository;
  let userId: string;
  let otherId: string;
  beforeEach(() => {
    db = openDatabase(':memory:');
    teams = new SqliteTeamRepository(db);
    memberships = new SqliteMembershipRepository(db);
    const users = new SqliteUserRepository(db);
    userId = users.insert({ id: randomUUID(), email: 'a@x.y', name: 'A' }).id;
    otherId = users.insert({ id: randomUUID(), email: 'b@x.y', name: 'B' }).id;
  });
  afterEach(() => db.close());

  const add = (name: string, createdAt?: string, id: string = randomUUID()) => {
    const team = teams.insert({ id, name });
    if (createdAt) db.prepare('UPDATE teams SET created_at = ? WHERE id = ?').run(createdAt, id);
    return team;
  };

  it('insert returns a team with a timestamp; findById hits and misses', () => {
    const team = add('A');
    expect(team.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(teams.findById(team.id)).toEqual(team);
    expect(teams.findById(randomUUID())).toBeUndefined();
  });

  it('listForMember lists oldest first with id tie-break, total, and limit/offset', () => {
    const all = [
      add('c', '2024-01-03T00:00:00.000Z'),
      add('a', '2024-01-01T00:00:00.000Z'),
      add('b2', '2024-01-02T00:00:00.000Z', 'bbbbbbbb-0000-0000-0000-000000000002'),
      add('b1', '2024-01-02T00:00:00.000Z', 'bbbbbbbb-0000-0000-0000-000000000001'),
    ];
    for (const t of all) memberships.add(t.id, userId);
    expect(teams.listForMember(userId, 10, 0).items.map((t) => t.name)).toEqual(['a', 'b1', 'b2', 'c']);
    const page = teams.listForMember(userId, 2, 1);
    expect(page.items.map((t) => t.name)).toEqual(['b1', 'b2']);
    expect(page.total).toBe(4);
    expect(teams.listForMember(userId, 10, 10)).toEqual({ items: [], total: 4 });
  });

  it('listForMember returns only the teams the user belongs to', () => {
    const mine = add('mine');
    const shared = add('shared');
    const theirs = add('theirs');
    memberships.add(mine.id, userId);
    memberships.add(shared.id, userId);
    memberships.add(shared.id, otherId);
    memberships.add(theirs.id, otherId);
    add('nobody');
    expect(teams.listForMember(userId, 10, 0).items.map((t) => t.name).sort()).toEqual(['mine', 'shared']);
    expect(teams.listForMember(otherId, 10, 0).total).toBe(2);
    expect(teams.listForMember(randomUUID(), 10, 0)).toEqual({ items: [], total: 0 });
  });
});
