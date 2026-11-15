import type { User } from '../domain/entities.js';
import type { MembershipRepository, Page } from '../domain/repositories.js';
import type { Db } from './connection.js';
import { toUser, type UserRow } from './user-repository.js';

export class SqliteMembershipRepository implements MembershipRepository {
  private readonly addStmt;
  private readonly removeStmt;
  private readonly isMemberStmt;
  private readonly listStmt;
  private readonly countStmt;

  constructor(private readonly db: Db) {
    this.addStmt = db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)');
    this.removeStmt = db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?');
    this.isMemberStmt = db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?');
    this.listStmt = db.prepare(
      `SELECT u.id, u.email, u.name, u.created_at FROM users u
       JOIN team_members m ON m.user_id = u.id
       WHERE m.team_id = ?
       ORDER BY u.created_at, u.id LIMIT ? OFFSET ?`,
    );
    this.countStmt = db.prepare('SELECT COUNT(*) AS total FROM team_members WHERE team_id = ?');
  }

  add(teamId: string, userId: string): void {
    this.addStmt.run(teamId, userId);
  }

  remove(teamId: string, userId: string): void {
    this.removeStmt.run(teamId, userId);
  }

  isMember(teamId: string, userId: string): boolean {
    return this.isMemberStmt.get(teamId, userId) !== undefined;
  }

  /** One query for any number of ids; callers cap the list (50), far below SQLite's parameter limit. */
  findMemberTeamIds(userId: string, teamIds: string[]): string[] {
    if (teamIds.length === 0) return [];
    const placeholders = teamIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT team_id FROM team_members WHERE user_id = ? AND team_id IN (${placeholders})`)
      .all(userId, ...teamIds) as { team_id: string }[];
    return rows.map((r) => r.team_id);
  }

  listMembers(teamId: string, limit: number, offset: number): Page<User> {
    const rows = this.listStmt.all(teamId, limit, offset) as UserRow[];
    const { total } = this.countStmt.get(teamId) as { total: number };
    return { items: rows.map(toUser), total };
  }
}
