import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, User } from '../../../src/domain/entities.js';
import { NotFoundError, ValidationError } from '../../../src/domain/errors.js';
import type { RunInTransaction } from '../../../src/domain/repositories.js';
import { AccessService } from '../../../src/services/access-service.js';
import { NoteService } from '../../../src/services/note-service.js';
import { FakeMembershipRepository, FakeNoteRepository, runInline } from '../../helpers/fakes.js';

const mkUser = (id: string): User => ({ id, email: `${id}@x.y`, name: id, createdAt: '2024-01-01T00:00:00.000Z' });
const user = mkUser('user-1');
const stranger = mkUser('user-2');
const TEAM_MSG = 'team_ids must be existing teams that you belong to';

describe('NoteService', () => {
  let notes: FakeNoteRepository;
  let memberships: FakeMembershipRepository;
  let service: NoteService;
  const teamA = 'team-a';
  const teamB = 'team-b';
  const teamOther = 'team-other'; // exists, but the user does not belong to it

  beforeEach(() => {
    notes = new FakeNoteRepository();
    memberships = new FakeMembershipRepository();
    service = new NoteService(notes, memberships, new AccessService(memberships), runInline);
    memberships.add(teamA, user.id);
    memberships.add(teamB, user.id);
    memberships.add(teamOther, stranger.id);
  });

  describe('create', () => {
    it('sets the owner from the current user and trims the title', () => {
      const note = service.create(user, { title: '  Hi  ', body: 'b', teamIds: [] });
      expect(note.ownerId).toBe(user.id);
      expect(note.title).toBe('Hi');
      expect(notes.findById(note.id)?.title).toBe('Hi');
    });

    it('rejects blank and over-long titles', () => {
      expect(() => service.create(user, { title: '  ', body: '', teamIds: [] })).toThrow(
        ValidationError,
      );
      expect(() =>
        service.create(user, { title: 'x'.repeat(201), body: '', teamIds: [] }),
      ).toThrow(ValidationError);
      expect(notes.insertCount).toBe(0);
    });

    it('rejects unknown team ids with a fixed message that does not echo the ids', () => {
      const run = () =>
        service.create(user, { title: 't', body: '', teamIds: [teamA, 'nope-1', 'nope-2'] });
      expect(run).toThrow(ValidationError);
      expect(run).toThrow(TEAM_MSG);
      try {
        run();
      } catch (err) {
        expect((err as Error).message).not.toContain('nope');
      }
      expect(notes.insertCount).toBe(0);
    });

    it('rejects a team the caller does not belong to, the same as an unknown one', () => {
      const run = () => service.create(user, { title: 't', body: '', teamIds: [teamA, teamOther] });
      expect(run).toThrow(ValidationError);
      expect(run).toThrow(TEAM_MSG);
      expect(notes.insertCount).toBe(0);
    });

    it('de-duplicates team ids and allows an empty list', () => {
      const note = service.create(user, { title: 't', body: '', teamIds: [teamA, teamA, teamB] });
      expect(note.teamIds).toEqual([teamA, teamB]);
      expect(service.create(user, { title: 't', body: '', teamIds: [] }).teamIds).toEqual([]);
    });

    it('gives each note a distinct id', () => {
      const a = service.create(user, { title: 't', body: '', teamIds: [] });
      const b = service.create(user, { title: 't', body: '', teamIds: [] });
      expect(a.id).not.toBe(b.id);
    });
  });

  describe('get', () => {
    it('returns the note to its owner', () => {
      const created = service.create(user, { title: 't', body: 'b', teamIds: [] });
      expect(service.get(user, created.id)).toEqual(created);
    });

    it('returns a team note to a member of its team', () => {
      const created = service.create(user, { title: 't', body: 'b', teamIds: [teamA] });
      memberships.add(teamA, stranger.id);
      expect(service.get(stranger, created.id)).toEqual(created);
    });

    it('throws NotFoundError for an unknown id', () => {
      expect(() => service.get(user, 'missing')).toThrow(NotFoundError);
    });

    it('throws NotFoundError for a note the caller cannot read, with the same message as a missing one', () => {
      const created = service.create(user, { title: 't', body: 'b', teamIds: [teamA] });
      expect(() => service.get(stranger, created.id)).toThrow(NotFoundError);
      expect(() => service.get(stranger, created.id)).toThrow(`Note ${created.id} not found`);
    });
  });

  describe('list', () => {
    it('passes the query and the viewer id to the repository and returns its page', () => {
      service.create(user, { title: 't', body: '', teamIds: [] });
      const input = { q: 'x', teamId: teamA, limit: 5, offset: 2 };
      const page = service.list(user, input);
      expect(notes.lastQuery).toEqual({ ...input, viewerId: user.id });
      expect(page).toEqual(notes.list({ ...input, viewerId: user.id }));
    });
  });

  describe('update', () => {
    let existing: Note;

    beforeEach(() => {
      existing = service.create(user, { title: 'old', body: 'old body', teamIds: [teamA] });
    });

    it('throws NotFoundError for an unknown id', () => {
      expect(() => service.update(user, 'missing', { title: 'x' })).toThrow(NotFoundError);
    });

    it('keeps omitted fields', () => {
      expect(service.update(user, existing.id, { title: 'new' })).toMatchObject({
        title: 'new',
        body: 'old body',
        teamIds: [teamA],
      });
      expect(service.update(user, existing.id, { body: 'nb' })).toMatchObject({
        title: 'new',
        body: 'nb',
      });
    });

    it('replaces team ids instead of merging, and clears with an empty list', () => {
      expect(service.update(user, existing.id, { teamIds: [teamB] }).teamIds).toEqual([teamB]);
      expect(service.update(user, existing.id, { teamIds: [] }).teamIds).toEqual([]);
    });

    it('rejects unknown team ids and leaves the stored note unchanged', () => {
      expect(() => service.update(user, existing.id, { title: 'new', teamIds: ['nope'] })).toThrow(
        ValidationError,
      );
      expect(notes.findById(existing.id)).toEqual(existing);
    });

    it('rejects a team the caller does not belong to and writes nothing', () => {
      expect(() => service.update(user, existing.id, { teamIds: [teamOther] })).toThrow(TEAM_MSG);
      expect(notes.updateCount).toBe(0);
    });

    it('trims the title and rejects a blank one', () => {
      expect(service.update(user, existing.id, { title: '  t2 ' }).title).toBe('t2');
      expect(() => service.update(user, existing.id, { title: ' ' })).toThrow(ValidationError);
    });

    it('lets a team member edit and preserves the owner', () => {
      memberships.add(teamA, stranger.id);
      const updated = service.update(stranger, existing.id, { title: 'x' });
      expect(updated.title).toBe('x');
      expect(updated.ownerId).toBe(user.id);
    });

    it('throws NotFoundError and writes nothing when the caller cannot read the note', () => {
      expect(() => service.update(stranger, existing.id, { title: 'x' })).toThrow(NotFoundError);
      expect(notes.updateCount).toBe(0);
    });

    it('runs inside the transaction runner', () => {
      const runner = vi.fn(runInline) as unknown as RunInTransaction;
      const svc = new NoteService(notes, memberships, new AccessService(memberships), runner);
      svc.update(user, existing.id, { title: 'x' });
      expect(runner).toHaveBeenCalledTimes(1);
    });
  });
});
