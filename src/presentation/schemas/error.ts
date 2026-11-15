import { Type, type Static } from 'typebox';

export const ErrorResponse = Type.Object(
  {
    error: Type.String({ description: 'Short error name, e.g. "Not Found"' }),
    message: Type.String({ description: 'Human-readable explanation' }),
  },
  { $id: 'ErrorResponse', description: 'Standard error body' },
);
export type ErrorResponseDto = Static<typeof ErrorResponse>;
