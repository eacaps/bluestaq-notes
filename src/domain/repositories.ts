import type { NewNote, NewTeam, NewUser, Note, Team, User } from './entities.js';

export interface Page<T> {
  items: T[];
  total: number;
}

export interface NoteQuery {
  q?: string;
  teamId?: string;
  /** The caller. Only notes this user can read are listed and counted. */
  viewerId: string;
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
  /** Teams the user belongs to, oldest first. */
  listForMember(userId: string, limit: number, offset: number): Page<Team>;
}

export interface NoteRepository {
  /** Inserts the note and its team links and returns the stored note. Callers wrap this in a transaction. */
  insert(note: NewNote): Note;
  /** Replaces the note's fields and team links, refreshes updated_at, and returns the stored note. Callers wrap this in a transaction. */
  update(note: NewNote): Note;
  findById(id: string): Note | undefined;
  list(query: NoteQuery): Page<Note>;
}

/** Team membership. Members are equal: there are no roles. */
export interface MembershipRepository {
  /** Idempotent. */
  add(teamId: string, userId: string): void;
  /** Idempotent. */
  remove(teamId: string, userId: string): void;
  isMember(teamId: string, userId: string): boolean;
  /** Returns the subset of the given team ids the user belongs to. Unknown teams have no members, so they are never returned. */
  findMemberTeamIds(userId: string, teamIds: string[]): string[];
  listMembers(teamId: string, limit: number, offset: number): Page<User>;
}

/** Runs the function atomically. Services use this instead of a database handle. */
export type RunInTransaction = <T>(fn: () => T) => T;
