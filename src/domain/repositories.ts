import type { NewNote, NewTeam, NewUser, Note, Team, User } from './entities.js';

export interface Page<T> {
  items: T[];
  total: number;
}

export interface NoteQuery {
  q?: string;
  teamId?: string;
  limit: number;
  offset: number;
}

export interface UserRepository {
  findById(id: string): User | undefined;
  findByEmail(email: string): User | undefined;
  /** Stores the user and returns it with database-assigned timestamps. */
  insert(user: NewUser): User;
}

export interface TeamRepository {
  /** Stores the team and returns it with database-assigned timestamps. */
  insert(team: NewTeam): Team;
  findById(id: string): Team | undefined;
  list(limit: number, offset: number): Page<Team>;
  /** Returns the subset of the given ids that exist. */
  findExistingIds(ids: string[]): string[];
}

export interface NoteRepository {
  /** Inserts the note and its team links and returns the stored note. Callers wrap this in a transaction. */
  insert(note: NewNote): Note;
  /** Replaces the note's fields and team links, refreshes updated_at, and returns the stored note. Callers wrap this in a transaction. */
  update(note: NewNote): Note;
  findById(id: string): Note | undefined;
  list(query: NoteQuery): Page<Note>;
}

/** Runs the function atomically. Services use this instead of a database handle. */
export type RunInTransaction = <T>(fn: () => T) => T;
