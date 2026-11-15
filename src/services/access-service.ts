import type { Note, User } from '../domain/entities.js';
import type { MembershipRepository } from '../domain/repositories.js';

/**
 * Access rules (stage 2b). A note with no teams is private to its owner. The
 * owner and every member of any team on the note can read and edit it. Only the
 * owner can delete. Called by services, never by routes.
 */
export class AccessService {
  constructor(private readonly memberships: MembershipRepository) {}

  canRead(user: User, note: Note): boolean {
    return this.canReadOrEdit(user, note);
  }

  canWrite(user: User, note: Note): boolean {
    return this.canReadOrEdit(user, note);
  }

  /** Not used until delete exists (stage 4). */
  canDelete(user: User, note: Note): boolean {
    return note.ownerId === user.id;
  }

  /**
   * Keep equivalent to the visibility predicate in SqliteNoteRepository.list
   * (src/data/note-repository.ts); change both together.
   */
  private canReadOrEdit(user: User, note: Note): boolean {
    if (note.ownerId === user.id) return true;
    return this.memberships.findMemberTeamIds(user.id, note.teamIds).length > 0;
  }
}
