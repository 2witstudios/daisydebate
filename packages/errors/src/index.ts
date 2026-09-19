const definitions = {
  VALIDATION: [400, 'Invalid input'],
  AUTHENTICATION: [401, 'Authentication required'],
  AUTHORIZATION: [403, 'Permission denied'],
  NOT_FOUND: [404, 'Resource not found'],
  CONFLICT: [409, 'Resource conflict'],
  INVARIANT: [422, 'Domain operation is not allowed'],
  RATE_LIMIT: [429, 'Too many requests'],
  INFRASTRUCTURE: [503, 'Service temporarily unavailable'],
  INTERNAL: [500, 'Unexpected internal error'],
} as const;
export type ErrorCode = keyof typeof definitions;
export type AppError = Error & { readonly code: ErrorCode };
const knownErrors = new WeakSet<Error>();
/** Details and cause remain internal. Public messages are fixed by error code. */
export function createAppError(
  code: ErrorCode,
  message: string = definitions[code][1],
  cause?: unknown,
): AppError {
  const error = Object.assign(new Error(message, { cause }), { code });
  knownErrors.add(error);
  return error;
}
/** Only factory-minted errors carry a trustworthy public code. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof Error && knownErrors.has(error);
}
export function toPublicError(error: unknown, requestId: string) {
  const code = isAppError(error) ? error.code : 'INTERNAL';
  return {
    status: definitions[code][0],
    body: { error: { code, message: definitions[code][1], requestId } },
  };
}
