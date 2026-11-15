import type { FastifyPluginAsync } from 'fastify';
import { Type } from 'typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { GetCurrentUser } from '../current-user.js';
import type { TeamService } from '../../services/team-service.js';
import { toTeamDto, toUserDto } from '../mappers.js';
import { IdParams, PaginationQuery } from '../schemas/common.js';
import { ErrorResponse, serverErrorResponses, unauthorizedResponses } from '../schemas/error.js';
import { Team, TeamCreate, TeamList, TeamMemberParams } from '../schemas/team.js';
import { UserList } from '../schemas/user.js';

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
        description:
          'Creates a team that notes can be labeled with. The creator becomes its first member.',
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
        description:
          'Returns only the teams the caller belongs to, oldest first, as a paginated envelope.',
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
      const page = teams.list(getCurrentUser(request), limit, offset);
      return { items: page.items.map(toTeamDto), total: page.total, limit, offset };
    },
  );

  app.get(
    '/teams/:id',
    {
      schema: {
        tags,
        summary: 'Get a team',
        description:
          'Fetches one team by id. Responds 404 when the team does not exist or the caller is not a member.',
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
    async (request) => toTeamDto(teams.get(getCurrentUser(request), request.params.id)),
  );

  app.get(
    '/teams/:id/members',
    {
      schema: {
        tags,
        summary: 'List team members',
        description:
          'Returns the members of a team, earliest registered first, as a paginated envelope. Members only: 404 when the team does not exist or the caller is not a member.',
        params: IdParams,
        querystring: PaginationQuery,
        response: {
          200: UserList,
          400: ErrorResponse,
          404: ErrorResponse,
          ...unauthorizedResponses(),
          ...serverErrorResponses(),
        },
      },
    },
    async (request) => {
      const { limit, offset } = request.query;
      const page = teams.listMembers(getCurrentUser(request), request.params.id, limit, offset);
      return { items: page.items.map(toUserDto), total: page.total, limit, offset };
    },
  );

  app.put(
    '/teams/:id/members/:userId',
    {
      schema: {
        tags,
        summary: 'Add a team member',
        description:
          'Adds an existing user to the team. Any member may do this. Idempotent: adding a current member also returns 204. Non-members get 404 for the team, so a user cannot join by themselves. 404 also when the user does not exist.',
        params: TeamMemberParams,
        response: {
          204: Type.Null({ description: 'Added (or already a member)' }),
          400: ErrorResponse,
          404: ErrorResponse,
          ...unauthorizedResponses(),
          ...serverErrorResponses(),
        },
      },
    },
    async (request, reply) => {
      teams.addMember(getCurrentUser(request), request.params.id, request.params.userId);
      return reply.code(204).send(null);
    },
  );

  app.delete(
    '/teams/:id/members/:userId',
    {
      schema: {
        tags,
        summary: 'Remove a team member',
        description:
          'Removes a user from the team. Any member may remove any member, including themselves; members are equal. Removing a user who is not a member also returns 204. Non-members get 404 for the team. Removing the last member leaves a team nobody can see.',
        params: TeamMemberParams,
        response: {
          204: Type.Null({ description: 'Removed (or was not a member)' }),
          400: ErrorResponse,
          404: ErrorResponse,
          ...unauthorizedResponses(),
          ...serverErrorResponses(),
        },
      },
    },
    async (request, reply) => {
      teams.removeMember(getCurrentUser(request), request.params.id, request.params.userId);
      return reply.code(204).send(null);
    },
  );
};
