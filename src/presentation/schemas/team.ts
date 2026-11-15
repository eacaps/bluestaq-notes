import { Type, type Static } from 'typebox';
import { listEnvelope } from './common.js';

export const Team = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
    created_at: Type.String({ format: 'date-time' }),
  },
  { $id: 'Team' },
);
export type TeamDto = Static<typeof Team>;

export const TeamCreate = Type.Object(
  {
    name: Type.String({
      pattern: '\\S',
      description:
        'Trimmed of surrounding whitespace before storing. Must not be blank, at most 100 characters after trimming.',
    }),
  },
  { $id: 'TeamCreate', additionalProperties: false },
);

export const TeamList = listEnvelope('TeamList', Team);
