import type { FastifyInstance } from 'fastify';
import { ErrorResponse } from './error.js';
import { Note, NoteCreate, NoteList, NoteUpdate } from './note.js';
import { Team, TeamCreate, TeamList } from './team.js';

/** Registers every shared model once. Routes reference them with ref(). */
export function registerSchemas(app: FastifyInstance): void {
  for (const schema of [
    ErrorResponse,
    Team,
    TeamCreate,
    TeamList,
    Note,
    NoteCreate,
    NoteUpdate,
    NoteList,
  ]) {
    app.addSchema(schema);
  }
}
