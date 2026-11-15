import { Type, type Static, type TSchema, type TUnsafe } from 'typebox';

/**
 * Reference to a shared model registered with app.addSchema (by its $id).
 * typebox 1.x infers Type.Ref('Id') as unknown unless a compile context is
 * supplied, which Fastify does not do, so the static type is restored here.
 */
export const ref = <T extends TSchema>(schema: T): TUnsafe<Static<T>> => {
  const id = (schema as { $id?: string }).$id;
  if (id === undefined) throw new Error('ref() needs a schema with an $id');
  return Type.Unsafe<Static<T>>(Type.Ref(id));
};
