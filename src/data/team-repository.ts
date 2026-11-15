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

  constructor(db: Db) {
    this.insertStmt = db.prepare(
      'INSERT INTO teams (id, name) VALUES (@id, @name)',
    );
    this.byIdStmt = db.prepare('SELECT id, name, created_at FROM teams WHERE id = ?');
    this.listStmt = db.prepare(
      `SELECT t.id, t.name, t.created_at FROM teams t
       JOIN team_members m ON m.team_id = t.id
       WHERE m.user_id = ?
       ORDER BY t.created_at, t.id LIMIT ? OFFSET ?`,
    );
    this.countStmt = db.prepare('SELECT COUNT(*) AS total FROM team_members WHERE user_id = ?');
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

  listForMember(userId: string, limit: number, offset: number): Page<Team> {
    const rows = this.listStmt.all(userId, limit, offset) as TeamRow[];
    const { total } = this.countStmt.get(userId) as { total: number };
    return { items: rows.map(toTeam), total };
  }

}
