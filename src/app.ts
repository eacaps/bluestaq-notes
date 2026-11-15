import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { createTransactionRunner, openDatabase } from './data/connection.js';
import { SqliteNoteRepository } from './data/note-repository.js';
import { seedDefaultUser } from './data/seed.js';
import { SqliteTeamRepository } from './data/team-repository.js';
import { SqliteUserRepository } from './data/user-repository.js';
import { defaultUserResolver } from './presentation/current-user.js';
import { registerErrorHandler } from './presentation/error-handler.js';
import { noteRoutes } from './presentation/routes/notes.js';
import { teamRoutes } from './presentation/routes/teams.js';
import { registerSchemas } from './presentation/schemas/index.js';
import { AccessService } from './services/access-service.js';
import { NoteService } from './services/note-service.js';
import { TeamService } from './services/team-service.js';

export interface AppOptions {
  dbPath: string;
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
  const defaultUser = seedDefaultUser(users);

  // Business layer
  const access = new AccessService();
  const teamService = new TeamService(teams);
  const noteService = new NoteService(notes, teams, access, createTransactionRunner(db));

  // Presentation layer
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
        description: 'Notes shared by small teams. Stage 1: single seeded user, no authentication.',
      },
      tags: [
        { name: 'Notes', description: 'Create, list, read and update notes' },
        { name: 'Teams', description: 'Create, list and read teams' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  registerSchemas(app);
  registerErrorHandler(app);
  await app.register(noteRoutes, {
    notes: noteService,
    getCurrentUser: defaultUserResolver(defaultUser),
  });
  await app.register(teamRoutes, { teams: teamService });

  return app;
}
