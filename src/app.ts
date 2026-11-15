import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { createTransactionRunner, openDatabase } from './data/connection.js';
import { SqliteNoteRepository } from './data/note-repository.js';
import { seedDefaultUser } from './data/seed.js';
import { SqliteTeamRepository } from './data/team-repository.js';
import { SqliteUserRepository } from './data/user-repository.js';
import { getCurrentUser, registerAuthentication } from './presentation/current-user.js';
import { registerErrorHandler } from './presentation/error-handler.js';
import { authRoutes } from './presentation/routes/auth.js';
import { noteRoutes } from './presentation/routes/notes.js';
import { teamRoutes } from './presentation/routes/teams.js';
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
  seedDefaultUser(users);

  // Business layer
  const access = new AccessService();
  const authService = new AuthService(users);
  const teamService = new TeamService(teams);
  const noteService = new NoteService(notes, teams, access, createTransactionRunner(db));

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
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Notes Service API',
        version: '0.1.0',
        description:
          'Notes shared by small teams. Stage 2a: bearer-token authentication without passwords (login needs only an email), and no access rules yet.',
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
        { name: 'Teams', description: 'Create, list and read teams' },
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
