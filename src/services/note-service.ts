import { randomUUID } from 'node:crypto';
import type { Note, User } from '../domain/entities.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import type {
  NoteRepository,
  MembershipRepository,
  Page,
  RunInTransaction,
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
    private readonly memberships: MembershipRepository,
    private readonly access: AccessService,
    private readonly runInTransaction: RunInTransaction,
  ) {}

  create(user: User, input: CreateNoteInput): Note {
    const title = normalizeLabel('title', input.title, 200);
    return this.runInTransaction(() => {
      const teamIds = this.validTeamIds(user, input.teamIds);
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
    return this.findReadable(user, id);
  }

  list(user: User, input: ListNotesInput): Page<Note> {
    // Visibility is applied in the repository query so that `total` stays correct.
    return this.notes.list({ ...input, viewerId: user.id });
  }

  update(user: User, id: string, input: UpdateNoteInput): Note {
    // Pure input normalization stays outside; everything that reads stored
    // state (the note, access check, team existence) runs in the transaction.
    const title =
      input.title === undefined ? undefined : normalizeLabel('title', input.title, 200);
    return this.runInTransaction(() => {
      const existing = this.findReadable(user, id);
      if (!this.access.canWrite(user, existing)) {
        throw new ForbiddenError('Not allowed to edit this note');
      }
      return this.notes.update({
        id: existing.id,
        ownerId: existing.ownerId,
        title: title ?? existing.title,
        body: input.body ?? existing.body,
        teamIds: input.teamIds ? this.validTeamIds(user, input.teamIds) : existing.teamIds,
      });
    });
  }

  private find(id: string): Note {
    const note = this.notes.findById(id);
    if (!note) throw new NotFoundError(`Note ${id} not found`);
    return note;
  }

  /** An unreadable note looks exactly like a missing one. */
  private findReadable(user: User, id: string): Note {
    const note = this.find(id);
    if (!this.access.canRead(user, note)) throw new NotFoundError(`Note ${id} not found`);
    return note;
  }

  /**
   * Every id must be a team the caller belongs to. Unknown and non-member ids
   * fail identically (a missing team has no members), with a fixed message that
   * does not echo ids.
   */
  private validTeamIds(user: User, ids: string[]): string[] {
    const unique = [...new Set(ids)];
    const member = new Set(this.memberships.findMemberTeamIds(user.id, unique));
    if (unique.some((id) => !member.has(id))) {
      throw new ValidationError('team_ids must be existing teams that you belong to');
    }
    return unique;
  }
}
