import { randomUUID } from 'node:crypto';
import type { Team, User } from '../domain/entities.js';
import { NotFoundError } from '../domain/errors.js';
import type { Page, TeamRepository } from '../domain/repositories.js';
import { normalizeLabel } from './label.js';

export class TeamService {
  constructor(private readonly teams: TeamRepository) {}

  /** `_user` is the caller. Stage 2b makes them the team's first member. */
  create(_user: User, input: { name: string }): Team {
    return this.teams.insert({ id: randomUUID(), name: normalizeLabel('name', input.name, 100) });
  }

  get(id: string): Team {
    const team = this.teams.findById(id);
    if (!team) throw new NotFoundError(`Team ${id} not found`);
    return team;
  }

  list(limit: number, offset: number): Page<Team> {
    return this.teams.list(limit, offset);
  }
}
