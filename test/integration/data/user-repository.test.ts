import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../../../src/data/connection.js';
import { ConflictError } from '../../../src/domain/errors.js';
import { DEFAULT_USER_EMAIL, seedDefaultUser } from '../../../src/data/seed.js';
import { SqliteUserRepository } from '../../../src/data/user-repository.js';

describe('SqliteUserRepository, seed and connection', () => {
  let db: Db;
  let users: SqliteUserRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    users = new SqliteUserRepository(db);
  });
  afterEach(() => db.close());

  it('inserts and finds by id and email', () => {
    const id = randomUUID();
    const stored = users.insert({ id, email: 'a@x.y', name: 'A' });
    expect(stored.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(users.findById(id)).toEqual(stored);
    expect(users.findByEmail('a@x.y')).toEqual(stored);
  });

  it('returns undefined for misses', () => {
    expect(users.findById(randomUUID())).toBeUndefined();
    expect(users.findByEmail('none@x.y')).toBeUndefined();
  });

  it('rejects a duplicate email with ConflictError and keeps the first user', () => {
    const first = users.insert({ id: randomUUID(), email: 'a@x.y', name: 'A' });
    expect(() => users.insert({ id: randomUUID(), email: 'a@x.y', name: 'B' })).toThrow(ConflictError);
    expect(users.findByEmail('a@x.y')).toEqual(first);
  });

  it('stores the email as given: normalizing is the service job', () => {
    users.insert({ id: randomUUID(), email: 'Mixed@X.Y', name: 'A' });
    expect(users.findByEmail('Mixed@X.Y')).toBeDefined();
    expect(users.findByEmail('mixed@x.y')).toBeUndefined();
  });

  it('rethrows an error that is not a unique violation', () => {
    const insertNullEmail = () =>
      users.insert({ id: randomUUID(), email: null as unknown as string, name: 'A' });
    expect(insertNullEmail).toThrow(/NOT NULL/);
    expect(insertNullEmail).not.toThrow(ConflictError);
  });

  it('seeds the default user once', () => {
    const first = seedDefaultUser(users);
    const second = seedDefaultUser(users);
    expect(first.email).toBe(DEFAULT_USER_EMAIL);
    expect(DEFAULT_USER_EMAIL).toBe('eacaps@gmail.com');
    expect(first.name).toBe('eacaps');
    expect(second).toEqual(first);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    expect(n).toBe(1);
  });

  it('creates all tables and enables foreign keys', () => {
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of ['users', 'teams', 'team_members', 'notes', 'note_teams']) {
      expect(names).toContain(t);
    }
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});
