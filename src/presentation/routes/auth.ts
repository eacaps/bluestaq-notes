import type { FastifyPluginAsync } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { User } from '../../domain/entities.js';
import type { AuthService } from '../../services/auth-service.js';
import type { GetCurrentUser } from '../current-user.js';
import { toUserDto } from '../mappers.js';
import {
  ErrorResponse,
  serverErrorResponses,
  unauthorizedResponses,
} from '../schemas/error.js';
import { AuthRequest, AuthResponse, RegisterRequest, User as UserSchema } from '../schemas/user.js';

export interface AuthRoutesOptions {
  auth: AuthService;
  getCurrentUser: GetCurrentUser;
  /** Signs a token for the user. Tokens are an HTTP concern, so the service never sees them. */
  signToken: (user: User) => string;
}

const tags = ['Auth'];

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (instance, opts) => {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const { auth, getCurrentUser, signToken } = opts;

  const authResponse = (user: User) => ({ token: signToken(user), user: toUserDto(user) });

  app.post(
    '/auth/register',
    {
      schema: {
        tags,
        summary: 'Register a user',
        description:
          'Creates a user and returns a bearer token. The email is trimmed and lower-cased; a second registration of the same email fails with 409. No password is involved in this stage.',
        security: [],
        body: RegisterRequest,
        response: {
          201: AuthResponse,
          400: ErrorResponse,
          409: ErrorResponse,
          ...serverErrorResponses(),
        },
      },
    },
    async (request, reply) => reply.code(201).send(authResponse(auth.register(request.body))),
  );

  app.post(
    '/auth/login',
    {
      schema: {
        tags,
        summary: 'Log in',
        description:
          'Returns a bearer token for a registered email. **There is no password in this stage, so login proves nothing: anyone who knows an email can act as that user.** Passwords arrive in stage 5. An unknown email returns 401.',
        security: [],
        body: AuthRequest,
        response: {
          200: AuthResponse,
          400: ErrorResponse,
          ...unauthorizedResponses(),
          ...serverErrorResponses(),
        },
      },
    },
    async (request) => authResponse(auth.login(request.body)),
  );

  app.get(
    '/users/me',
    {
      schema: {
        tags,
        summary: 'Get the current user',
        description: 'Returns the user the bearer token belongs to.',
        response: { 200: UserSchema, ...unauthorizedResponses(), ...serverErrorResponses() },
      },
    },
    async (request) => toUserDto(getCurrentUser(request)),
  );
};
