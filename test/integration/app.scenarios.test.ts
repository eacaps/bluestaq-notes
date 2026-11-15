import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, createNote, createTeam, type NoteBody } from '../helpers/build-test-app.js';

interface Page {
  items: NoteBody[];
  total: number;
  limit: number;
  offset: number;
}

describe('API scenarios', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildTestApp();
  });
  afterEach(() => app.close());

  const list = async (qs = ''): Promise<Page> =>
    (await app.inject({ method: 'GET', url: `/notes${qs}` })).json<Page>();
  const ids = (page: Page) => page.items.map((n) => n.id);

  it('team filters follow PATCH of team_ids', async () => {
    const a = await createTeam(app, 'A');
    const b = await createTeam(app, 'B');
    const n = await createNote(app, { title: 'N', body: '', team_ids: [a.id, b.id] });
    expect(ids(await list(`?team=${a.id}`))).toEqual([n.id]);
    expect(ids(await list(`?team=${b.id}`))).toEqual([n.id]);

    await app.inject({ method: 'PATCH', url: `/notes/${n.id}`, payload: { team_ids: [a.id] } });
    const forB = await list(`?team=${b.id}`);
    expect(forB.items).toEqual([]);
    expect(forB.total).toBe(0);
    expect(ids(await list(`?team=${a.id}`))).toEqual([n.id]);

    await app.inject({ method: 'PATCH', url: `/notes/${n.id}`, payload: { team_ids: [] } });
    expect((await list(`?team=${a.id}`)).total).toBe(0);
    expect((await list(`?team=${b.id}`)).total).toBe(0);
    expect(ids(await list())).toEqual([n.id]);
  });

  it('searches text containing special characters', async () => {
    const pct = await createNote(app, { title: '100% done', body: '' });
    const snake = await createNote(app, { title: 'snake_case_name', body: '' });
    await createNote(app, { title: 'plain text', body: '' });
    const bs = await createNote(app, { title: 'a\\b', body: '' });
    const bodyHit = await createNote(app, { title: 'zzz', body: 'Contains MiXeD Case' });

    expect(ids(await list(`?q=${encodeURIComponent('%')}`))).toEqual([pct.id]);
    expect(ids(await list(`?q=${encodeURIComponent('_')}`))).toEqual([snake.id]);
    expect(ids(await list(`?q=${encodeURIComponent('\\')}`))).toEqual([bs.id]);
    expect(ids(await list('?q=PLAIN')).length).toBe(1);
    expect(ids(await list('?q=mixed%20case'))).toEqual([bodyHit.id]);

    const team = await createTeam(app, 'T');
    await app.inject({ method: 'PATCH', url: `/notes/${snake.id}`, payload: { team_ids: [team.id] } });
    expect(ids(await list(`?q=snake&team=${team.id}`))).toEqual([snake.id]);
    expect((await list(`?q=plain&team=${team.id}`)).total).toBe(0);
  });

  it('pages through 25 notes in a stable order', async () => {
    for (let i = 0; i < 25; i++) await createNote(app, { title: `n${i}`, body: '' });
    const pages = [await list('?limit=10&offset=0'), await list('?limit=10&offset=10'), await list('?limit=10&offset=20')];
    expect(pages.map((p) => p.items.length)).toEqual([10, 10, 5]);
    expect(pages.map((p) => p.total)).toEqual([25, 25, 25]);
    const all = pages.flatMap((p) => p.items);
    expect(new Set(all.map((n) => n.id)).size).toBe(25);
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1]!;
      const cur = all[i]!;
      const ordered =
        prev.created_at > cur.created_at || (prev.created_at === cur.created_at && prev.id < cur.id);
      expect(ordered).toBe(true);
    }
    const beyond = await list('?offset=25');
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(25);
  });

  it('edit flow is visible in get, list and search', async () => {
    const n = await createNote(app, { title: 'oldtitle', body: '' });
    const res = await app.inject({ method: 'PATCH', url: `/notes/${n.id}`, payload: { title: 'newtitle' } });
    expect(res.statusCode).toBe(200);
    const got = (await app.inject({ method: 'GET', url: `/notes/${n.id}` })).json<NoteBody>();
    expect(got.title).toBe('newtitle');
    expect(got.updated_at >= got.created_at).toBe(true);
    expect((await list()).items[0]?.title).toBe('newtitle');
    expect(ids(await list('?q=newtitle'))).toEqual([n.id]);
    expect((await list('?q=oldtitle')).total).toBe(0);
  });

  it('trims the title on create', async () => {
    const n = await createNote(app, { title: '  padded  ', body: '' });
    const got = (await app.inject({ method: 'GET', url: `/notes/${n.id}` })).json<NoteBody>();
    expect(got.title).toBe('padded');
    expect(ids(await list('?q=padded'))).toEqual([n.id]);
  });
});
