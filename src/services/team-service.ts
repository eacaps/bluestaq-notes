import { randomUUID } from 'node:crypto';
import type { Team, User } from '../domain/entities.js';
import { NotFoundError } from '../domain/errors.js';
import type {
  MembershipRepository,
  Page,
  RunInTransaction,
  TeamRepository,
  UserRepository,
} from '../domain/repositories.js';
import { normalizeLabel } from './label.js';

/**
 * Teams and membership. All members are equal. A caller who is not a member
 * gets the same NotFoundError as for a team that does not exist.
 */
export class TeamService {
  constructor(
    private readonly teams: TeamRepository,
    private readonly memberships: MembershipRepository,
    private readonly users: UserRepository,
    private readonly runInTransaction: RunInTransaction,
  ) {}

  /** The caller becomes the first member, in the same transaction as the insert. */
  create(user: User, input: { name: string }): Team {
    const name = normalizeLabel('name', input.name, 100);
    return this.runInTransaction(() => {
      const team = this.teams.insert({ id: randomUUID(), name });
      this.memberships.add(team.id, user.id);
      return team;
    });
  }

  get(user: User, id: string): Team {
    this.requireMember(user, id);
    const team = this.teams.findById(id);
    if (!team) throw this.notFound(id);
    return team;
  }

  list(user: User, limit: number, offset: number): Page<Team> {
    return this.teams.listForMember(user.id, limit, offset);
  }

  /** Idempotent. Any member may add any existing user. */
  addMember(user: User, teamId: string, userId: string): void {
    this.runInTransaction(() => {
      this.requireMember(user, teamId);
      if (!this.users.findById(userId)) throw new NotFoundError(`User ${userId} not found`);
      this.memberships.add(teamId, userId);
    });
  }

  /** Idempotent. Any member may remove any member, including themselves. */
  removeMember(user: User, teamId: string, userId: string): void {
    this.runInTransaction(() => {
      this.requireMember(user, teamId);
      this.memberships.remove(teamId, userId);
    });
  }

  listMembers(user: User, teamId: string, limit: number, offset: number): Page<User> {
    this.requireMember(user, teamId);
    return this.memberships.listMembers(teamId, limit, offset);
  }

  private requireMember(user: User, teamId: string): void {
    if (!this.memberships.isMember(teamId, user.id)) throw this.notFound(teamId);
  }

  private notFound(teamId: string): NotFoundError {
    return new NotFoundError(`Team ${teamId} not found`);
  }
}
