import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/build-test-app.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

describe('OpenAPI', () => {
  let app: FastifyInstance;
  let spec: Json;
  beforeEach(async () => {
    app = await buildTestApp();
    spec = app.swagger();
  });
  afterEach(() => app.close());

  it('generates OpenAPI 3.0.3 and serves it at /docs/json', async () => {
    expect(spec.openapi).toBe('3.0.3');
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
  });

  it('documents every route and method', () => {
    const methods = (p: string) => Object.keys(spec.paths[p] ?? {}).sort();
    expect(methods('/notes')).toEqual(['get', 'post']);
    expect(methods('/notes/{id}')).toEqual(['get', 'patch']);
    expect(methods('/teams')).toEqual(['get', 'post']);
    expect(methods('/teams/{id}')).toEqual(['get']);
  });

  it('gives every operation 2xx and 500 responses with content schemas', () => {
    for (const [path, item] of Object.entries<Json>(spec.paths)) {
      if (!['/notes', '/notes/{id}', '/teams', '/teams/{id}'].includes(path)) continue;
      for (const [method, op] of Object.entries<Json>(item)) {
        const label = `${method} ${path}`;
        const codes = Object.keys(op.responses);
        expect(codes.some((c) => c.startsWith('2')), label).toBe(true);
        expect(codes, label).toContain('500');
        const hasInput = Boolean(op.requestBody) || (op.parameters ?? []).length > 0;
        if (hasInput) expect(codes, label).toContain('400');
        for (const [code, response] of Object.entries<Json>(op.responses)) {
          expect(response.content?.['application/json']?.schema, `${label} ${code}`).toBeDefined();
        }
      }
    }
  });

  it('defines Note and Team once under components/schemas and references them from list items', () => {
    const names = Object.keys(spec.components.schemas);
    expect(names.filter((n) => n === 'Note')).toHaveLength(1);
    expect(names.filter((n) => n === 'Team')).toHaveLength(1);
    expect(names.filter((n) => /^def-\d+$/.test(n))).toEqual([]);
    const noteItems = spec.paths['/notes'].get.responses['200'].content['application/json'].schema.properties.items;
    const teamItems = spec.paths['/teams'].get.responses['200'].content['application/json'].schema.properties.items;
    expect(noteItems.items.$ref).toBe('#/components/schemas/Note');
    expect(teamItems.items.$ref).toBe('#/components/schemas/Team');
  });

  // KNOWN GAP: docs/DESIGN.md says each shared model appears once under
  // components/schemas, but today only Note and Team do. NoteCreate, NoteUpdate,
  // NoteList, TeamCreate, TeamList and ErrorResponse are inlined into each
  // operation. Fixing it changes production output, so it is reported, not fixed.
  it.todo('defines NoteCreate, NoteUpdate, NoteList, TeamCreate, TeamList and ErrorResponse once under components/schemas');
});
