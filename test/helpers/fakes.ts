import type { NewNote, NewTeam, NewUser, Note, Team, User } from '../../src/domain/entities.js';
import { ConflictError } from '../../src/domain/errors.js';
import type {
  MembershipRepository,
  NoteQuery,
  NoteRepository,
  Page,
  RunInTransaction,
  TeamRepository,
  UserRepository,
} from '../../src/domain/repositories.js';

const now = () => new Date().toISOString();

export class FakeUserRepository implements UserRepository {
  readonly rows = new Map<string, User>();

  insert(user: NewUser): User {
    if (this.findByEmail(user.email)) throw new ConflictError('A user with this email already exists');
    const stored = { ...user, createdAt: now() };
    this.rows.set(user.id, stored);
    return stored;
  }

  findById(id: string): User | undefined {
    return this.rows.get(id);
  }

  findByEmail(email: string): User | undefined {
    return [...this.rows.values()].find((u) => u.email === email);
  }
}

/** Shared by the team and membership fakes so both see the same data: teamId -> user ids (insertion order). */
export type MemberMap = Map<string, Set<string>>;

export class FakeMembershipRepository implements MembershipRepository {
  constructor(
    readonly members: MemberMap = new Map(),
    private readonly users: FakeUserRepository = new FakeUserRepository(),
  ) {}

  add(teamId: string, userId: string): void {
    const set = this.members.get(teamId) ?? new Set<string>();
    set.add(userId);
    this.members.set(teamId, set);
  }

  remove(teamId: string, userId: string): void {
    this.members.get(teamId)?.delete(userId);
  }

  isMember(teamId: string, userId: string): boolean {
    return this.members.get(teamId)?.has(userId) ?? false;
  }

  findMemberTeamIds(userId: string, teamIds: string[]): string[] {
    return teamIds.filter((id) => this.isMember(id, userId));
  }

  listMembers(teamId: string, limit: number, offset: number): Page<User> {
    const all = [...(this.members.get(teamId) ?? [])]
      .map((id) => this.users.findById(id))
      .filter((u): u is User => u !== undefined);
    return { items: all.slice(offset, offset + limit), total: all.length };
  }
}

export class FakeTeamRepository implements TeamRepository {
  readonly rows = new Map<string, Team>();

  constructor(private readonly members: MemberMap = new Map()) {}

  insert(team: NewTeam): Team {
    const stored = { ...team, createdAt: now() };
    this.rows.set(team.id, stored);
    return stored;
  }

  findById(id: string): Team | undefined {
    return this.rows.get(id);
  }

  listForMember(userId: string, limit: number, offset: number): Page<Team> {
    const all = [...this.rows.values()].filter((t) => this.members.get(t.id)?.has(userId));
    return { items: all.slice(offset, offset + limit), total: all.length };
  }
}

export class FakeNoteRepository implements NoteRepository {
  readonly rows = new Map<string, Note>();
  lastQuery: NoteQuery | undefined;
  insertCount = 0;
  updateCount = 0;

  insert(note: NewNote): Note {
    this.insertCount++;
    const stored = { ...note, teamIds: [...note.teamIds], createdAt: now(), updatedAt: now() };
    this.rows.set(note.id, stored);
    return stored;
  }

  update(note: NewNote): Note {
    this.updateCount++;
    const existing = this.rows.get(note.id);
    if (!existing) throw new Error('update of missing note');
    const stored = { ...existing, ...note, teamIds: [...note.teamIds], updatedAt: now() };
    this.rows.set(note.id, stored);
    return stored;
  }

  findById(id: string): Note | undefined {
    return this.rows.get(id);
  }

  /** Records the query and does not filter by viewer: visibility is the SQL repository's job. */
  list(query: NoteQuery): Page<Note> {
    this.lastQuery = query;
    const all = [...this.rows.values()];
    return { items: all.slice(query.offset, query.offset + query.limit), total: all.length };
  }
}

/** Users, teams and memberships wired to one shared member map. */
export function createFakeWorld() {
  const members: MemberMap = new Map();
  const users = new FakeUserRepository();
  return {
    users,
    teams: new FakeTeamRepository(members),
    memberships: new FakeMembershipRepository(members, users),
  };
}

export const runInline: RunInTransaction = (fn) => fn();
