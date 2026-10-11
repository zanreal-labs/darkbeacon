export type ErrorCode = 'not_found' | 'forbidden' | 'unauthenticated' | 'conflict' | 'validation';

/** Expected failure of a use case. The HTTP edge maps `code` to a status. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string, details?: unknown) {
    super('not_found', `${what} not found`, details);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You are not allowed to do that', details?: unknown) {
    super('forbidden', message, details);
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = 'Sign in first') {
    super('unauthenticated', message);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('conflict', message, details);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('validation', message, details);
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
