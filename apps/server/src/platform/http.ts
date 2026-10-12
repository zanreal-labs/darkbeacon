import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
  type PipeTransform,
} from '@nestjs/common';
import { isDomainError, type ErrorCode } from '@darkbeacon/core';
import type { ApiErrorBody, ApiErrorCode } from '@darkbeacon/shared';
import type { FastifyReply } from 'fastify';
import { ZodError, type z } from 'zod';

/** Validates a body/query/param with a zod schema: `@Body(new ZodPipe(CreateMapRequest))`. */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    return this.schema.parse(value);
  }
}

const domainStatus: Record<ErrorCode, number> = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

const httpCode: Record<number, ApiErrorCode> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
};

export function toApiError(error: unknown): { status: number; body: ApiErrorBody } {
  if (isDomainError(error)) {
    const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
    if (error.details !== undefined) body.error.details = error.details;
    return { status: domainStatus[error.code], body };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'validation',
          message: 'Invalid request',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
    };
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    return {
      status,
      body: {
        error: {
          code: httpCode[status] ?? (status < 500 ? 'bad_request' : 'internal'),
          message: error.message,
        },
      },
    };
  }
  return { status: 500, body: { error: { code: 'internal', message: 'Internal server error' } } };
}

/** Every HTTP error leaves as `{ error: { code, message, details? } }`. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;
    const { status, body } = toApiError(exception);
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    void host.switchToHttp().getResponse<FastifyReply>().status(status).send(body);
  }
}
