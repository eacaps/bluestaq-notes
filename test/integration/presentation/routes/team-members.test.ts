import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  as,
  buildTestApp,
  createTeam,
  defaultUserToken,
  registerUser,
  type Session,
  type TeamBody,
  type UserBody,
} from '../../../helpers/build-test-app.js';

interface MemberPage {
  items: UserBody[];
  total: number;
  limit: number;
  offset: number;
}

describe('/teams/:id/members', () => {
  let app: FastifyInstance;
  let alice: Session;
  let bob: Session;
  let carol: Session;
  let team: TeamBody;

  beforeEach(async () => {
    app = await buildTestApp();
    alice = await defaultUserToken(app);
    bob = await registerUser(app, 'bob@x.y', 'Bob');
    carol = await registerUser(app, 'carol@x.y', 'Carol');
    team = await createTeam(app, 'T', alice.token);
  });
  afterEach(() => app.close());

  const as_ = (s: Session) => as(app, s.token);
  const members = async (s: Session, qs = '') =>
    (await as_(s).get(`/teams/${team.id}/members${qs}`)).json<MemberPage>();

  describe('PUT', () => {
    it('lets a member add a registered user, who then sees the team', async () => {
      const res = await as_(alice).put(`/teams/${team.id}/members/${bob.user.id}`);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      const list = (await as_(bob).get('/teams')).json();
      expect(list.items.map((t: TeamBody) => t.id)).toEqual([team.id]);
      expect((await as_(bob).get(`/teams/${team.id}`)).statusCode).toBe(200);
    });

    it('is idempotent', async () => {
      const url = `/teams/${team.id}/members/${bob.user.id}`;
      expect((await as_(alice).put(url)).statusCode).toBe(204);
      expect((await as_(alice).put(url)).statusCode).toBe(204);
      expect((await members(alice)).total).toBe(2);
    });

    it('returns 404 to a non-member caller and does not let them join themselves', async () => {
      const res = await as_(bob).put(`/teams/${team.id}/members/${bob.user.id}`);
      expect(res.statusCode).toBe(404);
      expect((await members(alice)).total).toBe(1);
    });

    it('returns 404 for an unknown user, and for an unknown team', async () => {
      const unknownUser = await as_(alice).put(`/teams/${team.id}/members/${randomUUID()}`);
      expect(unknownUser.statusCode).toBe(404);
      expect(unknownUser.json()).toMatchObject({ error: 'Not Found' });
      const unknownTeam = await as_(alice).put(`/teams/${randomUUID()}/members/${bob.user.id}`);
      expect(unknownTeam.statusCode).toBe(404);
    });

    it.each([
      ['team id', (bobId: string) => `/teams/nope/members/${bobId}`],
      ['user id', () => `/teams/${randomUUID()}/members/nope`],
    ])('returns 400 for a malformed %s', async (_label, url) => {
      const res = await as_(alice).put(url(bob.user.id));
      expect(res.statusCode).toBe(400);
      expect(Object.keys(res.json()).sort()).toEqual(['error', 'message']);
    });
  });

  describe('GET', () => {
    it('returns the envelope with the user shape', async () => {
      const page = await members(alice);
      expect(page).toMatchObject({ total: 1, limit: 20, offset: 0 });
      expect(page.items).toEqual([alice.user]);
      expect(Object.keys(page.items[0]!).sort()).toEqual(['created_at', 'email', 'id', 'name']);
    });

    it('orders earliest-registered first and pages', async () => {
      await as_(alice).put(`/teams/${team.id}/members/${carol.user.id}`);
      await as_(alice).put(`/teams/${team.id}/members/${bob.user.id}`);
      const all = await members(alice);
      const created = all.items.map((u) => u.created_at);
      expect([...created].sort()).toEqual(created);
      expect(all.items[0]!.id).toBe(alice.user.id);
      const page = await members(alice, '?limit=1&offset=1');
      expect(page).toMatchObject({ total: 3, limit: 1, offset: 1 });
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toEqual(all.items[1]);
    });

    it('returns 404 to a non-member and for an unknown team', async () => {
      expect((await as_(bob).get(`/teams/${team.id}/members`)).statusCode).toBe(404);
      expect((await as_(alice).get(`/teams/${randomUUID()}/members`)).statusCode).toBe(404);
    });

    it.each(['limit=0', 'limit=101', 'offset=-1', 'limit=abc'])('rejects %s with 400', async (qs) => {
      expect((await as_(alice).get(`/teams/${team.id}/members?${qs}`)).statusCode).toBe(400);
    });

    it('returns 400 for a malformed team id', async () => {
      expect((await as_(alice).get('/teams/nope/members')).statusCode).toBe(400);
    });
  });

  describe('DELETE', () => {
    beforeEach(async () => {
      await as_(alice).put(`/teams/${team.id}/members/${bob.user.id}`);
    });

    it('lets a member remove another, who then gets 404 on the team', async () => {
      const res = await as_(alice).delete(`/teams/${team.id}/members/${bob.user.id}`);
      expect(res.statusCode).toBe(204);
      expect((await as_(bob).get(`/teams/${team.id}`)).statusCode).toBe(404);
      expect((await as_(bob).get('/teams')).json().total).toBe(0);
    });

    it('lets a member remove themselves', async () => {
      expect((await as_(bob).delete(`/teams/${team.id}/members/${bob.user.id}`)).statusCode).toBe(204);
      expect((await as_(bob).get(`/teams/${team.id}`)).statusCode).toBe(404);
      expect((await members(alice)).total).toBe(1);
    });

    it('returns 204 for a target who is not a member', async () => {
      const res = await as_(alice).delete(`/teams/${team.id}/members/${carol.user.id}`);
      expect(res.statusCode).toBe(204);
      expect((await members(alice)).total).toBe(2);
    });

    it('returns 404 to a non-member caller and removes nothing', async () => {
      const res = await as_(carol).delete(`/teams/${team.id}/members/${bob.user.id}`);
      expect(res.statusCode).toBe(404);
      expect((await members(alice)).total).toBe(2);
    });

    it('leaves a team nobody can read when the last member is removed', async () => {
      await as_(bob).delete(`/teams/${team.id}/members/${bob.user.id}`);
      await as_(alice).delete(`/teams/${team.id}/members/${alice.user.id}`);
      for (const s of [alice, bob, carol]) {
        expect((await as_(s).get(`/teams/${team.id}`)).statusCode).toBe(404);
        expect((await as_(s).get(`/teams/${team.id}/members`)).statusCode).toBe(404);
      }
    });

    it('returns 400 for malformed ids', async () => {
      expect((await as_(alice).delete(`/teams/${team.id}/members/nope`)).statusCode).toBe(400);
      expect((await as_(alice).delete(`/teams/nope/members/${bob.user.id}`)).statusCode).toBe(400);
    });
  });
});
