import type { FastifyPluginAsync } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { NoteService } from '../../services/note-service.js';
import type { GetCurrentUser } from '../current-user.js';
import { toNoteDto } from '../mappers.js';
import { IdParams } from '../schemas/common.js';
import {
  ErrorResponse,
  forbiddenResponses,
  serverErrorResponses,
  unauthorizedResponses,
} from '../schemas/error.js';
import { Note, NoteCreate, NoteList, NoteListQuery, NoteUpdate } from '../schemas/note.js';

export interface NoteRoutesOptions {
  notes: NoteService;
  getCurrentUser: GetCurrentUser;
}

const tags = ['Notes'];

export const noteRoutes: FastifyPluginAsync<NoteRoutesOptions> = async (instance, opts) => {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const { notes, getCurrentUser } = opts;
  app.post(
    '/notes',
    {
      schema: {
        tags,
        summary: 'Create a note',
        description:
          'Creates a note owned by the current user. Every id in `team_ids` must be an existing team, otherwise the request fails with 400.',
        body: NoteCreate,
        response: {
          201: Note,
          400: ErrorResponse,
          ...unauthorizedResponses(),
          ...serverErrorResponses(),
        },
      },
    },
    async (request, reply) => {
      const { title, body, team_ids } = request.body;
      const note = notes.create(getCurrentUser(request), {
        title,
        body,
        teamIds: team_ids ?? [],
      });
      return reply.code(201).send(toNoteDto(note));
    },
  );

  app.get(
    '/notes',
    {
      schema: {
        tags,
        summary: 'List notes',
        description:
          'Returns notes, newest first, as a paginated envelope. `q` matches title and body case-insensitively. `team` keeps only notes labeled with that team.',
        querystring: NoteListQuery,
        response: {
          200: NoteList,
          400: ErrorResponse,
          ...unauthorizedResponses(),
          ...serverErrorResponses(),
        },
      },
    },
    async (request) => {
      const { q, team, limit, offset } = request.query;
      const page = notes.list(getCurrentUser(request), { q, teamId: team, limit, offset });
      return { items: page.items.map(toNoteDto), total: page.total, limit, offset };
    },
  );

  app.get(
    '/notes/:id',
    {
      schema: {
        tags,
        summary: 'Get a note',
        description: 'Fetches one note by id.',
        params: IdParams,
        response: {
          200: Note,
          400: ErrorResponse,
          404: ErrorResponse,
          ...forbiddenResponses(),
          ...unauthorizedResponses(),
          ...serverErrorResponses(),
        },
      },
    },
    async (request) => toNoteDto(notes.get(getCurrentUser(request), request.params.id)),
  );

  app.patch(
    '/notes/:id',
    {
      schema: {
        tags,
        summary: 'Update a note',
        description:
          'Partially updates a note. Send at least one of `title`, `body`, `team_ids`. `team_ids` replaces the whole list and every id must exist.',
        params: IdParams,
        body: NoteUpdate,
        response: {
          200: Note,
          400: ErrorResponse,
          404: ErrorResponse,
          ...forbiddenResponses(),
          ...unauthorizedResponses(),
          ...serverErrorResponses(),
        },
      },
    },
    async (request) => {
      const { title, body, team_ids } = request.body;
      const note = notes.update(getCurrentUser(request), request.params.id, {
        title,
        body,
        teamIds: team_ids,
      });
      return toNoteDto(note);
    },
  );
};
