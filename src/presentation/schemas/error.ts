import { Type, type Static } from 'typebox';

export const ErrorResponse = Type.Object(
  {
    error: Type.String({ description: 'Short error name, e.g. "Not Found"' }),
    message: Type.String({ description: 'Human-readable explanation' }),
  },
  { $id: 'ErrorResponse', description: 'Standard error body' },
);
/** Any route can fail unexpectedly; spread into every route's `response` map. */
export const serverErrorResponses = () => ({ 500: ErrorResponse });

/** Every protected route; spread into its `response` map. */
export const unauthorizedResponses = () => ({ 401: ErrorResponse });

/** Routes that consult AccessService; spread alongside `serverErrorResponses`. */
export const forbiddenResponses = () => ({ 403: ErrorResponse });

export type ErrorResponseDto = Static<typeof ErrorResponse>;
