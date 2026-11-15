import type { NewTeam, Team } from '../domain/entities.js';
import type { Page, TeamRepository } from '../domain/repositories.js';
import type { Db } from './connection.js';

interface TeamRow {
  id: string;
  name: string;
  created_at: string;
}

const toTeam = (row: TeamRow): Team => ({ id: row.id, name: row.name, createdAt: row.created_at });

export class SqliteTeamRepository implements TeamRepository {
  private readonly insertStmt;
  private readonly byIdStmt;
  private readonly listStmt;
  private readonly countStmt;

  constructor(private readonly db: Db) {
    this.insertStmt = db.prepare(
      'INSERT INTO teams (id, name) VALUES (@id, @name)',
    );
    this.byIdStmt = db.prepare('SELECT id, name, created_at FROM teams WHERE id = ?');
    this.listStmt = db.prepare(
      'SELECT id, name, created_at FROM teams ORDER BY created_at, id LIMIT ? OFFSET ?',
    );
    this.countStmt = db.prepare('SELECT COUNT(*) AS total FROM teams');
  }

  insert(team: NewTeam): Team {
    this.insertStmt.run(team);
    const stored = this.findById(team.id);
    if (!stored) throw new Error(`Team ${team.id} missing after insert`);
    return stored;
  }

  findById(id: string): Team | undefined {
    const row = this.byIdStmt.get(id) as TeamRow | undefined;
    return row && toTeam(row);
  }

  list(limit: number, offset: number): Page<Team> {
    const rows = this.listStmt.all(limit, offset) as TeamRow[];
    const { total } = this.countStmt.get() as { total: number };
    return { items: rows.map(toTeam), total };
  }

  findExistingIds(ids: string[]): string[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT id FROM teams WHERE id IN (${placeholders})`)
      .all(...ids) as { id: string }[];
    return rows.map((r) => r.id);
  }
}
