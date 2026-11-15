import type { Note, User } from '../domain/entities.js';

/**
 * Access rules. Stage 1 allows everything. Stage 2b replaces these bodies with
 * the team-based rule; callers do not change.
 */
export class AccessService {
  canRead(_user: User, _note: Note): boolean {
    return true;
  }

  canWrite(_user: User, _note: Note): boolean {
    return true;
  }
}
