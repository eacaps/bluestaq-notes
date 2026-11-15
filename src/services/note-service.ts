import { randomUUID } from 'node:crypto';
import type { Note, User } from '../domain/entities.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import type {
  NoteRepository,
  Page,
  RunInTransaction,
  TeamRepository,
} from '../domain/repositories.js';
import type { AccessService } from './access-service.js';

export interface CreateNoteInput {
  title: string;
  body: string;
  teamIds: string[];
}

export interface UpdateNoteInput {
  title?: string;
  body?: string;
  teamIds?: string[];
}

export interface ListNotesInput {
  q?: string;
  teamId?: string;
  limit: number;
  offset: number;
}

export class NoteService {
  constructor(
    private readonly notes: NoteRepository,
    private readonly teams: TeamRepository,
    private readonly access: AccessService,
    private readonly runInTransaction: RunInTransaction,
  ) {}

  create(user: User, input: CreateNoteInput): Note {
    const teamIds = this.validTeamIds(input.teamIds);
    return this.runInTransaction(() =>
      this.notes.insert({
        id: randomUUID(),
        ownerId: user.id,
        title: input.title,
        body: input.body,
        teamIds,
      }),
    );
  }

  get(user: User, id: string): Note {
    const note = this.find(id);
    if (!this.access.canRead(user, note)) throw new ForbiddenError('Not allowed to read this note');
    return note;
  }

  list(user: User, input: ListNotesInput): Page<Note> {
    // Stage 2b moves visibility filtering into the repository query so that
    // `total` stays correct. Until then every note is readable.
    void user;
    return this.notes.list(input);
  }

  update(user: User, id: string, input: UpdateNoteInput): Note {
    const existing = this.find(id);
    if (!this.access.canWrite(user, existing)) {
      throw new ForbiddenError('Not allowed to edit this note');
    }
    const changes = {
      id: existing.id,
      ownerId: existing.ownerId,
      title: input.title ?? existing.title,
      body: input.body ?? existing.body,
      teamIds: input.teamIds ? this.validTeamIds(input.teamIds) : existing.teamIds,
    };
    return this.runInTransaction(() => this.notes.update(changes));
  }

  private find(id: string): Note {
    const note = this.notes.findById(id);
    if (!note) throw new NotFoundError(`Note ${id} not found`);
    return note;
  }

  private validTeamIds(ids: string[]): string[] {
    const unique = [...new Set(ids)];
    const existing = new Set(this.teams.findExistingIds(unique));
    const unknown = unique.filter((id) => !existing.has(id));
    if (unknown.length > 0) {
      throw new ValidationError(`Unknown team_ids: ${unknown.join(', ')}`);
    }
    return unique;
  }
}
