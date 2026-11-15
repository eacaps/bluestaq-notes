import { randomUUID } from 'node:crypto';
import type { User } from '../domain/entities.js';
import type { UserRepository } from '../domain/repositories.js';

export const DEFAULT_USER_EMAIL = 'eacaps@gmail.com';

/** Creates the default user if it is missing. Safe to run on every startup. */
export function seedDefaultUser(users: UserRepository): User {
  const existing = users.findByEmail(DEFAULT_USER_EMAIL);
  if (existing) return existing;
  return users.insert({ id: randomUUID(), email: DEFAULT_USER_EMAIL, name: 'Default User' });
}
