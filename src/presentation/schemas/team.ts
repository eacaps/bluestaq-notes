import { Type, type Static } from 'typebox';
import { listEnvelope } from './common.js';
import { ref } from './ref.js';

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
  { name: Type.String({ minLength: 1, maxLength: 100 }) },
  { $id: 'TeamCreate', additionalProperties: false },
);
export type TeamCreateDto = Static<typeof TeamCreate>;

export const TeamList = listEnvelope('TeamList', ref(Team));
