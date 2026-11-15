import { beforeEach, describe, expect, it } from 'vitest';
import type { Note, User } from '../../../src/domain/entities.js';
import { AccessService } from '../../../src/services/access-service.js';
import { FakeMembershipRepository } from '../../helpers/fakes.js';

const mkUser = (id: string): User => ({ id, email: `${id}@x.y`, name: id, createdAt: '2024-01-01T00:00:00.000Z' });
const owner = mkUser('owner');
const other = mkUser('other');
const mkNote = (teamIds: string[] = []): Note => ({
  id: 'n1',
  ownerId: owner.id,
  title: 't',
  body: 'b',
  teamIds,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
});

describe('AccessService (stage 2b: owner or team member)', () => {
  let memberships: FakeMembershipRepository;
  let access: AccessService;

  beforeEach(() => {
    memberships = new FakeMembershipRepository();
    access = new AccessService(memberships);
  });

  it('lets the owner read, write and delete a note with no teams', () => {
    const note = mkNote();
    expect(access.canRead(owner, note)).toBe(true);
    expect(access.canWrite(owner, note)).toBe(true);
    expect(access.canDelete(owner, note)).toBe(true);
  });

  it('keeps a private note away from other users', () => {
    const note = mkNote();
    expect(access.canRead(other, note)).toBe(false);
    expect(access.canWrite(other, note)).toBe(false);
    expect(access.canDelete(other, note)).toBe(false);
  });

  it('lets a member of any one of the note teams read and write', () => {
    memberships.add('t2', other.id);
    const note = mkNote(['t1', 't2', 't3']);
    expect(access.canRead(other, note)).toBe(true);
    expect(access.canWrite(other, note)).toBe(true);
  });

  it('denies a member of an unrelated team', () => {
    memberships.add('unrelated', other.id);
    const note = mkNote(['t1']);
    expect(access.canRead(other, note)).toBe(false);
    expect(access.canWrite(other, note)).toBe(false);
  });

  it('lets only the owner delete, even when a member can edit', () => {
    memberships.add('t1', other.id);
    const note = mkNote(['t1']);
    expect(access.canWrite(other, note)).toBe(true);
    expect(access.canDelete(other, note)).toBe(false);
  });

  it('lets the owner keep access when not a member of the note teams', () => {
    expect(access.canRead(owner, mkNote(['t1']))).toBe(true);
  });

  it('removes access when the membership is removed', () => {
    memberships.add('t1', other.id);
    const note = mkNote(['t1']);
    expect(access.canRead(other, note)).toBe(true);
    memberships.remove('t1', other.id);
    expect(access.canRead(other, note)).toBe(false);
    expect(access.canWrite(other, note)).toBe(false);
  });
});
