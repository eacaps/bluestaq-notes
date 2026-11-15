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
import { normalizeLabel } from './label.js';

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
    const title = normalizeLabel('title', input.title, 200);
    return this.runInTransaction(() => {
      const teamIds = this.validTeamIds(input.teamIds);
      return this.notes.insert({
        id: randomUUID(),
        ownerId: user.id,
        title,
        body: input.body,
        teamIds,
      });
    });
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
    // Pure input normalization stays outside; everything that reads stored
    // state (the note, access check, team existence) runs in the transaction.
    const title =
      input.title === undefined ? undefined : normalizeLabel('title', input.title, 200);
    return this.runInTransaction(() => {
      const existing = this.find(id);
      if (!this.access.canWrite(user, existing)) {
        throw new ForbiddenError('Not allowed to edit this note');
      }
      return this.notes.update({
        id: existing.id,
        ownerId: existing.ownerId,
        title: title ?? existing.title,
        body: input.body ?? existing.body,
        teamIds: input.teamIds ? this.validTeamIds(input.teamIds) : existing.teamIds,
      });
    });
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
