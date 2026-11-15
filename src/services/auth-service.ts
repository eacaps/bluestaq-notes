import { randomUUID } from 'node:crypto';
import type { User } from '../domain/entities.js';
import { UnauthorizedError, ValidationError } from '../domain/errors.js';
import type { UserRepository } from '../domain/repositories.js';
import { normalizeLabel } from './label.js';

const MAX_EMAIL_LENGTH = 254;
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trims and lower-cases, so lookups and the unique index see one form per address. */
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Users and identity. Tokens are a presentation concern; this service never sees them. */
export class AuthService {
  constructor(private readonly users: UserRepository) {}

  /** Throws ConflictError (via the repository) when the email is already registered. */
  register(input: { email: string; name: string }): User {
    const email = normalizeEmail(input.email);
    if (email.length > MAX_EMAIL_LENGTH || !EMAIL_FORMAT.test(email)) {
      throw new ValidationError('email must be a valid email address of at most 254 characters');
    }
    const name = normalizeLabel('name', input.name, 100);
    return this.users.insert({ id: randomUUID(), email, name });
  }

  /** Stage 2a: the email alone identifies the user. Stage 5 adds the password check. */
  login(input: { email: string }): User {
    const user = this.users.findByEmail(normalizeEmail(input.email));
    if (!user) throw new UnauthorizedError('Invalid credentials');
    return user;
  }

  /** Resolves the user a verified token refers to. */
  findById(id: string): User {
    const user = this.users.findById(id);
    if (!user) throw new UnauthorizedError('Invalid or expired token');
    return user;
  }
}
