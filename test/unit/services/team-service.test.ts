import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../../src/domain/entities.js';
import { NotFoundError, ValidationError } from '../../../src/domain/errors.js';
import type { RunInTransaction } from '../../../src/domain/repositories.js';
import { TeamService } from '../../../src/services/team-service.js';
import {
  createFakeWorld,
  runInline,
  type FakeMembershipRepository,
  type FakeTeamRepository,
  type FakeUserRepository,
} from '../../helpers/fakes.js';

describe('TeamService', () => {
  let teams: FakeTeamRepository;
  let memberships: FakeMembershipRepository;
  let users: FakeUserRepository;
  let service: TeamService;
  let alice: User;
  let bob: User;

  const build = (runner: RunInTransaction = runInline) =>
    new TeamService(teams, memberships, users, runner);

  beforeEach(() => {
    ({ teams, memberships, users } = createFakeWorld());
    service = build();
    alice = users.insert({ id: 'alice', email: 'alice@x.y', name: 'Alice' });
    bob = users.insert({ id: 'bob', email: 'bob@x.y', name: 'Bob' });
  });

  describe('create', () => {
    it('trims the name and makes the caller the first member', () => {
      const team = service.create(alice, { name: '  Platform  ' });
      expect(team.name).toBe('Platform');
      expect(teams.findById(team.id)).toEqual(team);
      expect(memberships.isMember(team.id, alice.id)).toBe(true);
      expect(memberships.isMember(team.id, bob.id)).toBe(false);
    });

    it('rejects blank and over-long names without inserting', () => {
      expect(() => service.create(alice, { name: '   ' })).toThrow(ValidationError);
      expect(() => service.create(alice, { name: 'x'.repeat(101) })).toThrow(ValidationError);
      expect(teams.rows.size).toBe(0);
      expect(service.create(alice, { name: 'x'.repeat(100) }).name).toHaveLength(100);
      expect(teams.rows.size).toBe(1);
    });

    it('runs inside the transaction runner', () => {
      const runner = vi.fn(runInline) as unknown as RunInTransaction;
      build(runner).create(alice, { name: 'a' });
      expect(runner).toHaveBeenCalledTimes(1);
    });
  });

  describe('get', () => {
    it('returns the team to a member', () => {
      const team = service.create(alice, { name: 'a' });
      expect(service.get(alice, team.id)).toEqual(team);
    });

    it('gives non-members and unknown ids the same NotFoundError shape', () => {
      const team = service.create(alice, { name: 'a' });
      expect(() => service.get(bob, team.id)).toThrow(NotFoundError);
      expect(() => service.get(bob, team.id)).toThrow(`Team ${team.id} not found`);
      expect(() => service.get(bob, 'missing')).toThrow('Team missing not found');
    });

    it('throws NotFoundError when a membership exists for a team row that is gone', () => {
      memberships.add('ghost', alice.id);
      expect(() => service.get(alice, 'ghost')).toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('returns only the caller teams with total and paging', () => {
      for (const name of ['a', 'b', 'c']) service.create(alice, { name });
      service.create(bob, { name: 'bobs' });
      const page = service.list(alice, 1, 1);
      expect(page.total).toBe(3);
      expect(page.items.map((t) => t.name)).toEqual(['b']);
      expect(service.list(bob, 10, 0).items.map((t) => t.name)).toEqual(['bobs']);
    });
  });

  describe('addMember', () => {
    it('lets a member add an existing user, idempotently', () => {
      const team = service.create(alice, { name: 'a' });
      service.addMember(alice, team.id, bob.id);
      service.addMember(alice, team.id, bob.id);
      expect(memberships.listMembers(team.id, 10, 0).total).toBe(2);
      expect(service.get(bob, team.id)).toEqual(team);
    });

    it('throws NotFoundError for a non-member caller (no self-join)', () => {
      const team = service.create(alice, { name: 'a' });
      expect(() => service.addMember(bob, team.id, bob.id)).toThrow(NotFoundError);
      expect(memberships.isMember(team.id, bob.id)).toBe(false);
    });

    it('throws NotFoundError for an unknown user and writes no membership', () => {
      const team = service.create(alice, { name: 'a' });
      expect(() => service.addMember(alice, team.id, 'nobody')).toThrow('User nobody not found');
      expect(memberships.isMember(team.id, 'nobody')).toBe(false);
    });

    it('runs inside the transaction runner', () => {
      const team = service.create(alice, { name: 'a' });
      const runner = vi.fn(runInline) as unknown as RunInTransaction;
      build(runner).addMember(alice, team.id, bob.id);
      expect(runner).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeMember', () => {
    it('lets a member remove another member, or themselves', () => {
      const team = service.create(alice, { name: 'a' });
      service.addMember(alice, team.id, bob.id);
      service.removeMember(alice, team.id, bob.id);
      expect(memberships.isMember(team.id, bob.id)).toBe(false);
      service.removeMember(alice, team.id, alice.id);
      expect(memberships.isMember(team.id, alice.id)).toBe(false);
    });

    it('is idempotent for a target who is not a member', () => {
      const team = service.create(alice, { name: 'a' });
      expect(() => service.removeMember(alice, team.id, bob.id)).not.toThrow();
      expect(memberships.isMember(team.id, alice.id)).toBe(true);
    });

    it('throws NotFoundError for a non-member caller', () => {
      const team = service.create(alice, { name: 'a' });
      expect(() => service.removeMember(bob, team.id, alice.id)).toThrow(NotFoundError);
      expect(memberships.isMember(team.id, alice.id)).toBe(true);
    });

    it('runs inside the transaction runner', () => {
      const team = service.create(alice, { name: 'a' });
      const runner = vi.fn(runInline) as unknown as RunInTransaction;
      build(runner).removeMember(alice, team.id, alice.id);
      expect(runner).toHaveBeenCalledTimes(1);
    });
  });

  describe('listMembers', () => {
    it('returns the members with paging', () => {
      const team = service.create(alice, { name: 'a' });
      service.addMember(alice, team.id, bob.id);
      expect(service.listMembers(alice, team.id, 10, 0).items.map((u) => u.id)).toEqual(['alice', 'bob']);
      const page = service.listMembers(bob, team.id, 1, 1);
      expect(page.total).toBe(2);
      expect(page.items.map((u) => u.id)).toEqual(['bob']);
    });

    it('throws NotFoundError for a non-member and for an unknown team', () => {
      const team = service.create(alice, { name: 'a' });
      expect(() => service.listMembers(bob, team.id, 10, 0)).toThrow(NotFoundError);
      expect(() => service.listMembers(alice, 'missing', 10, 0)).toThrow(NotFoundError);
    });
  });
});
