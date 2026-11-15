import { Type, type Static } from 'typebox';
import { PaginationQuery, listEnvelope } from './common.js';

export const MAX_TEAM_IDS = 50;

const teamIds = (description: string) =>
  Type.Array(Type.String({ format: 'uuid' }), { maxItems: MAX_TEAM_IDS, description });

export const Note = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    owner_id: Type.String({ format: 'uuid' }),
    title: Type.String(),
    body: Type.String(),
    team_ids: teamIds('Teams the note is labeled with'),
    created_at: Type.String({ format: 'date-time' }),
    updated_at: Type.String({ format: 'date-time' }),
  },
  { $id: 'Note' },
);
export type NoteDto = Static<typeof Note>;

const TITLE_DESC =
  'Trimmed of surrounding whitespace before storing. Must not be blank, at most 200 characters after trimming.';
export const NoteCreate = Type.Object(
  {
    title: Type.String({ pattern: '\\S', description: TITLE_DESC }),
    body: Type.String({ maxLength: 100_000 }),
    team_ids: Type.Optional(teamIds('Teams to label the note with. Every id must exist.')),
  },
  { $id: 'NoteCreate', additionalProperties: false },
);

export const NoteUpdate = Type.Object(
  {
    title: Type.Optional(Type.String({ pattern: '\\S', description: TITLE_DESC })),
    body: Type.Optional(Type.String({ maxLength: 100_000 })),
    team_ids: Type.Optional(teamIds('Replaces the note\'s teams. Every id must exist.')),
  },
  { $id: 'NoteUpdate', additionalProperties: false, minProperties: 1 },
);

export const NoteList = listEnvelope('NoteList', Note);

export const NoteListQuery = Type.Evaluate(
  Type.Intersect([
    Type.Object({
      q: Type.Optional(Type.String({ description: 'Case-insensitive text match on title and body' })),
      team: Type.Optional(
        Type.String({ format: 'uuid', description: 'Only notes labeled with this team' }),
      ),
    }),
    PaginationQuery,
  ]),
);
