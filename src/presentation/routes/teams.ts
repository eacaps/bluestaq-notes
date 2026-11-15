import type { FastifyPluginAsync } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { GetCurrentUser } from '../current-user.js';
import type { TeamService } from '../../services/team-service.js';
import { toTeamDto } from '../mappers.js';
import { IdParams, PaginationQuery } from '../schemas/common.js';
import { ErrorResponse, serverErrorResponses, unauthorizedResponses } from '../schemas/error.js';
import { Team, TeamCreate, TeamList } from '../schemas/team.js';

export interface TeamRoutesOptions {
  teams: TeamService;
  getCurrentUser: GetCurrentUser;
}

const tags = ['Teams'];

export const teamRoutes: FastifyPluginAsync<TeamRoutesOptions> = async (instance, opts) => {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const { teams, getCurrentUser } = opts;
  app.post(
    '/teams',
    {
      schema: {
        tags,
        summary: 'Create a team',
        description: 'Creates a team that notes can be labeled with.',
        body: TeamCreate,
        response: {
          201: Team,
          400: ErrorResponse,
          ...unauthorizedResponses(),
          ...serverErrorResponses(),
        },
      },
    },
    async (request, reply) => {
      const team = teams.create(getCurrentUser(request), { name: request.body.name });
      return reply.code(201).send(toTeamDto(team));
    },
  );

  app.get(
    '/teams',
    {
      schema: {
        tags,
        summary: 'List teams',
        description: 'Returns teams, oldest first, as a paginated envelope.',
        querystring: PaginationQuery,
        response: {
          200: TeamList,
          400: ErrorResponse,
          ...unauthorizedResponses(),
          ...serverErrorResponses(),
        },
      },
    },
    async (request) => {
      const { limit, offset } = request.query;
      const page = teams.list(limit, offset);
      return { items: page.items.map(toTeamDto), total: page.total, limit, offset };
    },
  );

  app.get(
    '/teams/:id',
    {
      schema: {
        tags,
        summary: 'Get a team',
        description: 'Fetches one team by id.',
        params: IdParams,
        response: {
          200: Team,
          400: ErrorResponse,
          404: ErrorResponse,
          ...unauthorizedResponses(),
          ...serverErrorResponses(),
        },
      },
    },
    async (request) => toTeamDto(teams.get(request.params.id)),
  );
};
