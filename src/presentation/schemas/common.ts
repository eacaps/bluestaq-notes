import { Type, type TSchema } from 'typebox';

export const IdParams = Type.Object({
  id: Type.String({ format: 'uuid', description: 'Resource id (UUID)' }),
});

export const PaginationQuery = Type.Object(
  {
    limit: Type.Integer({ minimum: 1, maximum: 100, default: 20, description: 'Page size' }),
    offset: Type.Integer({
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      default: 0,
      description: 'Items to skip',
    }),
  },
);

/** Builds a named list envelope so each list type is defined once. */
export const listEnvelope = <T extends TSchema>(id: string, item: T) =>
  Type.Object(
    {
      items: Type.Array(item),
      total: Type.Integer({ minimum: 0, description: 'Total matches, ignoring limit and offset' }),
      limit: Type.Integer({ minimum: 1 }),
      offset: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    },
    { $id: id },
  );
