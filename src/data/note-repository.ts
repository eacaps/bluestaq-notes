import type { NewNote, Note } from '../domain/entities.js';
import type { NoteQuery, NoteRepository, Page } from '../domain/repositories.js';
import type { Db } from './connection.js';

interface NoteRow {
  id: string;
  owner_id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, owner_id, title, body, created_at, updated_at';

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class SqliteNoteRepository implements NoteRepository {
  private readonly insertStmt;
  private readonly updateStmt;
  private readonly byIdStmt;
  private readonly linkStmt;
  private readonly unlinkStmt;
  private readonly teamIdsStmt;

  constructor(private readonly db: Db) {
    this.insertStmt = db.prepare(
      `INSERT INTO notes (id, owner_id, title, body)
       VALUES (@id, @ownerId, @title, @body)`,
    );
    this.updateStmt = db.prepare(
      `UPDATE notes SET title = @title, body = @body,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = @id`,
    );
    this.byIdStmt = db.prepare(`SELECT ${COLUMNS} FROM notes WHERE id = ?`);
    this.linkStmt = db.prepare('INSERT INTO note_teams (note_id, team_id) VALUES (?, ?)');
    this.unlinkStmt = db.prepare('DELETE FROM note_teams WHERE note_id = ?');
    this.teamIdsStmt = db.prepare(
      'SELECT team_id FROM note_teams WHERE note_id = ? ORDER BY rowid',
    );
  }

  insert(note: NewNote): Note {
    this.insertStmt.run(note);
    for (const teamId of note.teamIds) this.linkStmt.run(note.id, teamId);
    return this.reread(note.id);
  }

  update(note: NewNote): Note {
    // Always runs, so updated_at is refreshed even when only team links change.
    this.updateStmt.run(note);
    this.unlinkStmt.run(note.id);
    for (const teamId of note.teamIds) this.linkStmt.run(note.id, teamId);
    return this.reread(note.id);
  }

  findById(id: string): Note | undefined {
    const row = this.byIdStmt.get(id) as NoteRow | undefined;
    return row && this.toNote(row);
  }

  list(query: NoteQuery): Page<Note> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.q) {
      where.push(`(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')`);
      const pattern = `%${escapeLike(query.q)}%`;
      params.push(pattern, pattern);
    }
    if (query.teamId) {
      where.push('EXISTS (SELECT 1 FROM note_teams nt WHERE nt.note_id = notes.id AND nt.team_id = ?)');
      params.push(query.teamId);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { total } = this.db
      .prepare(`SELECT COUNT(*) AS total FROM notes ${clause}`)
      .get(...params) as { total: number };
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM notes ${clause} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`)
      .all(...params, query.limit, query.offset) as NoteRow[];
    return { items: rows.map((row) => this.toNote(row)), total };
  }

  private reread(id: string): Note {
    const note = this.findById(id);
    if (!note) throw new Error(`Note ${id} missing after write`);
    return note;
  }

  private toNote(row: NoteRow): Note {
    const teamIds = (this.teamIdsStmt.all(row.id) as { team_id: string }[]).map((r) => r.team_id);
    return {
      id: row.id,
      ownerId: row.owner_id,
      title: row.title,
      body: row.body,
      teamIds,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
