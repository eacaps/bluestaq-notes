import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, UnauthorizedError, ValidationError } from '../../../src/domain/errors.js';
import { AuthService } from '../../../src/services/auth-service.js';
import { FakeUserRepository } from '../../helpers/fakes.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('AuthService', () => {
  let users: FakeUserRepository;
  let service: AuthService;

  beforeEach(() => {
    users = new FakeUserRepository();
    service = new AuthService(users);
  });

  describe('register', () => {
    it('trims and lower-cases the email, trims the name, and stores a uuid id', () => {
      const user = service.register({ email: '  Ann@Example.COM ', name: '  Ann  ' });
      expect(user).toMatchObject({ email: 'ann@example.com', name: 'Ann' });
      expect(user.id).toMatch(UUID);
      expect(users.findById(user.id)).toEqual(user);
    });

    it('gives each user a distinct id', () => {
      const a = service.register({ email: 'a@x.y', name: 'A' });
      const b = service.register({ email: 'b@x.y', name: 'B' });
      expect(a.id).not.toBe(b.id);
    });

    it.each(['no-at', 'a@b', 'a b@c.d', '@x.y', 'a@.', '   '])('rejects the email %j', (email) => {
      expect(() => service.register({ email, name: 'N' })).toThrow(ValidationError);
      expect(users.rows.size).toBe(0);
    });

    it('rejects an email over 254 characters after normalization and accepts exactly 254', () => {
      const domain = '@x.yz';
      const ok = 'a'.repeat(254 - domain.length) + domain;
      expect(ok).toHaveLength(254);
      expect(service.register({ email: ok, name: 'N' }).email).toBe(ok);
      expect(() => service.register({ email: 'a' + ok, name: 'N' })).toThrow(ValidationError);
    });

    it('rejects a blank name and a name over 100 characters', () => {
      expect(() => service.register({ email: 'a@x.y', name: '   ' })).toThrow(ValidationError);
      expect(() => service.register({ email: 'a@x.y', name: 'x'.repeat(101) })).toThrow(ValidationError);
      expect(service.register({ email: 'a@x.y', name: 'x'.repeat(100) }).name).toHaveLength(100);
    });

    it('throws ConflictError for a duplicate email, also when case or whitespace differs', () => {
      service.register({ email: 'a@x.y', name: 'A' });
      expect(() => service.register({ email: 'a@x.y', name: 'B' })).toThrow(ConflictError);
      expect(() => service.register({ email: '  A@X.Y ', name: 'B' })).toThrow(ConflictError);
      expect(users.rows.size).toBe(1);
    });
  });

  describe('login', () => {
    it('ignores case and surrounding whitespace', () => {
      const user = service.register({ email: 'a@x.y', name: 'A' });
      expect(service.login({ email: ' A@X.Y ' })).toEqual(user);
    });

    it('throws UnauthorizedError for an unknown email', () => {
      expect(() => service.login({ email: 'nobody@x.y' })).toThrow(UnauthorizedError);
    });
  });

  describe('findById', () => {
    it('returns the user, and throws UnauthorizedError for an unknown id', () => {
      const user = service.register({ email: 'a@x.y', name: 'A' });
      expect(service.findById(user.id)).toEqual(user);
      expect(() => service.findById('missing')).toThrow(UnauthorizedError);
    });
  });
});
