import { Type, type Static } from 'typebox';
import { ref } from './ref.js';

export const ErrorResponse = Type.Object(
  {
    error: Type.String({ description: 'Short error name, e.g. "Not Found"' }),
    message: Type.String({ description: 'Human-readable explanation' }),
  },
  { $id: 'ErrorResponse', description: 'Standard error body' },
);
/** Any route can fail unexpectedly; spread into every route's `response` map. */
export const serverErrorResponses = () => ({ 500: ref(ErrorResponse) });

/** Routes that consult AccessService; spread alongside `serverErrorResponses`. */
export const forbiddenResponses = () => ({ 403: ref(ErrorResponse) });

export type ErrorResponseDto = Static<typeof ErrorResponse>;
