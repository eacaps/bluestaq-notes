import { randomUUID } from 'node:crypto';
import type { Team } from '../domain/entities.js';
import { NotFoundError } from '../domain/errors.js';
import type { Page, TeamRepository } from '../domain/repositories.js';

export class TeamService {
  constructor(private readonly teams: TeamRepository) {}

  create(input: { name: string }): Team {
    return this.teams.insert({ id: randomUUID(), name: input.name });
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
