import { STATUS_CODES } from 'node:http';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../domain/errors.js';
import type { ErrorResponseDto } from './schemas/error.js';

const send = (reply: FastifyReply, status: number, error: string, message: string) =>
  reply.code(status).send({ error, message } satisfies ErrorResponseDto);

/** Maps domain and framework errors to the standard `{ error, message }` body. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof NotFoundError) return send(reply, 404, 'Not Found', err.message);
    if (err instanceof ValidationError) return send(reply, 400, 'Bad Request', err.message);
    if (err instanceof ForbiddenError) return send(reply, 403, 'Forbidden', err.message);
    if (err.validation) return send(reply, 400, 'Bad Request', err.message);
    if (err.statusCode && err.statusCode < 500) {
      return send(reply, err.statusCode, STATUS_CODES[err.statusCode] ?? 'Bad Request', err.message);
    }
    request.log.error(err);
    return send(reply, 500, 'Internal Server Error', 'Unexpected error');
  });

  app.setNotFoundHandler((request, reply) =>
    send(reply, 404, 'Not Found', `Route ${request.method} ${request.url} not found`),
  );
}
