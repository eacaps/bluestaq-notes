import type { NewUser, User } from '../domain/entities.js';
import { ConflictError } from '../domain/errors.js';
import type { UserRepository } from '../domain/repositories.js';
import type { Db } from './connection.js';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  createdAt: row.created_at,
});

export class SqliteUserRepository implements UserRepository {
  private readonly insertStmt;
  private readonly byIdStmt;
  private readonly byEmailStmt;

  constructor(db: Db) {
    this.insertStmt = db.prepare(
      'INSERT INTO users (id, email, name) VALUES (@id, @email, @name)',
    );
    this.byIdStmt = db.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?');
    this.byEmailStmt = db.prepare('SELECT id, email, name, created_at FROM users WHERE email = ?');
  }

  insert(user: NewUser): User {
    try {
      this.insertStmt.run(user);
    } catch (err) {
      // Covers the check-then-insert race: the UNIQUE index on users.email is the final guard.
      if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new ConflictError('A user with this email already exists');
      }
      throw err;
    }
    const stored = this.findById(user.id);
    if (!stored) throw new Error(`User ${user.id} missing after insert`);
    return stored;
  }

  findById(id: string): User | undefined {
    const row = this.byIdStmt.get(id) as UserRow | undefined;
    return row && toUser(row);
  }

  findByEmail(email: string): User | undefined {
    const row = this.byEmailStmt.get(email) as UserRow | undefined;
    return row && toUser(row);
  }
}
