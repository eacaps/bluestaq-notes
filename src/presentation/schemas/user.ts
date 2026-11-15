import { Type, type Static } from 'typebox';
import { listEnvelope } from './common.js';

export const User = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    email: Type.String(),
    name: Type.String(),
    created_at: Type.String({ format: 'date-time' }),
  },
  { $id: 'User' },
);

export type UserDto = Static<typeof User>;

const EMAIL_DESC =
  'Trimmed and lower-cased before use. At most 254 characters.';

export const RegisterRequest = Type.Object(
  {
    email: Type.String({
      minLength: 1,
      maxLength: 300,
      description: `${EMAIL_DESC} Must be a valid email address. Must not already be registered.`,
    }),
    name: Type.String({
      pattern: '\\S',
      description:
        'Trimmed of surrounding whitespace before storing. Must not be blank, at most 100 characters after trimming.',
    }),
  },
  { $id: 'RegisterRequest', additionalProperties: false },
);

export const AuthRequest = Type.Object(
  {
    email: Type.String({ minLength: 1, maxLength: 300, description: EMAIL_DESC }),
  },
  { $id: 'AuthRequest', additionalProperties: false },
);

export const AuthResponse = Type.Object(
  {
    token: Type.String({ description: 'Bearer token (JWT). Send as `Authorization: Bearer <token>`' }),
    user: User,
  },
  { $id: 'AuthResponse' },
);

export type AuthResponseDto = Static<typeof AuthResponse>;

export const UserList = listEnvelope('UserList', User);
