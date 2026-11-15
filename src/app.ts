import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { createTransactionRunner, openDatabase } from './data/connection.js';
import { SqliteMembershipRepository } from './data/membership-repository.js';
import { SqliteNoteRepository } from './data/note-repository.js';
import { seedDefaultUser } from './data/seed.js';
import { SqliteTeamRepository } from './data/team-repository.js';
import { SqliteUserRepository } from './data/user-repository.js';
import { getCurrentUser, registerAuthentication } from './presentation/current-user.js';
import { registerErrorHandler } from './presentation/error-handler.js';
import { authRoutes } from './presentation/routes/auth.js';
import { noteRoutes } from './presentation/routes/notes.js';
import { teamRoutes } from './presentation/routes/teams.js';
import { AuthRequest, AuthResponse, RegisterRequest, User } from './presentation/schemas/user.js';
import { AccessService } from './services/access-service.js';
import { AuthService } from './services/auth-service.js';
import { NoteService } from './services/note-service.js';
import { TeamService } from './services/team-service.js';

export interface AppOptions {
  dbPath: string;
  /** HMAC secret for signing and verifying tokens. */
  jwtSecret: string;
  /** Token lifetime, e.g. `1h`, `30m`, or seconds as a number. */
  jwtExpiresIn: string | number;
  logger?: FastifyServerOptions['logger'];
}

/**
 * Top-level request and response schemas are inlined by @fastify/swagger (only nested
 * ones with an $id are hoisted). The auth models are documented once under
 * components/schemas and referenced, without registering them with Fastify.
 */
const SHARED_MODELS = { AuthRequest, AuthResponse, RegisterRequest, User } as const;
const isSharedModel = (s: unknown): s is { $id: keyof typeof SHARED_MODELS } =>
  typeof s === 'object' && s !== null && typeof (s as { $id?: unknown }).$id === 'string' &&
  (s as { $id: string }).$id in SHARED_MODELS;

const refTo = (s: { $id: string }) => ({ $ref: `#/components/schemas/${s.$id}` });

/** Composition root: the only place that knows every layer. */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true });

  // Data layer
  const db = openDatabase(options.dbPath);
  app.addHook('onClose', async () => {
    db.close();
  });
  const users = new SqliteUserRepository(db);
  const teams = new SqliteTeamRepository(db);
  const notes = new SqliteNoteRepository(db);
  const memberships = new SqliteMembershipRepository(db);
  const runInTransaction = createTransactionRunner(db);
  seedDefaultUser(users);

  // Business layer
  const access = new AccessService(memberships);
  const authService = new AuthService(users);
  const teamService = new TeamService(teams, memberships, users, runInTransaction);
  const noteService = new NoteService(notes, memberships, access, runInTransaction);

  // Presentation layer
  await app.register(jwt, {
    secret: options.jwtSecret,
    sign: { algorithm: 'HS256', expiresIn: options.jwtExpiresIn },
    verify: { algorithms: ['HS256'] },
  });
  // Registered before any route, so every route added later requires a token by default.
  registerAuthentication(app, authService);
  await app.register(swagger, {
    refResolver: {
      // Name components after the TypeBox $id instead of def-0, def-1, ...
      buildLocalReference: (json, _baseUri, _fragment, i) =>
        typeof json.$id === 'string' ? json.$id : `def-${i}`,
    },
    transform: ({ schema, url }) => {
      if (!schema) return { schema, url };
      const out: Record<string, unknown> = { ...schema };
      if (isSharedModel(out.body)) out.body = refTo(out.body);
      if (out.response && typeof out.response === 'object') {
        out.response = Object.fromEntries(
          Object.entries(out.response).map(([code, r]) => [code, isSharedModel(r) ? refTo(r) : r]),
        );
      }
      return { schema: out, url };
    },
    transformObject: (document) => {
      if (!('openapiObject' in document)) return document.swaggerObject;
      const openapiObject = document.openapiObject;
      const schemas = (openapiObject.components ??= {}).schemas ??= {};
      for (const [id, model] of Object.entries(SHARED_MODELS)) {
        const { $id: _id, ...rest } = JSON.parse(JSON.stringify(model));
        if (rest.properties?.user) rest.properties.user = { $ref: '#/components/schemas/User' };
        schemas[id] = rest;
      }
      return openapiObject;
    },
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Notes Service API',
        version: '0.1.0',
        description:
          'Notes shared by small teams. Bearer-token authentication without passwords (login needs only an email). Stage 2b: team-based access. A note is private to its owner unless labeled with teams; the owner and every member of those teams can read and edit it. Callers who cannot see a note or team get 404.',
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'Auth', description: 'Register, log in and read the current user' },
        { name: 'Notes', description: 'Create, list, read and update notes' },
        { name: 'Teams', description: 'Create teams, manage members, list and read the teams you belong to' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  registerErrorHandler(app);
  await app.register(authRoutes, {
    auth: authService,
    getCurrentUser,
    signToken: (user) => app.jwt.sign({ sub: user.id }),
  });
  await app.register(noteRoutes, { notes: noteService, getCurrentUser });
  await app.register(teamRoutes, { teams: teamService, getCurrentUser });

  return app;
}
