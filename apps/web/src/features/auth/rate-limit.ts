import { createHash } from 'node:crypto';
import { APIError, createAuthMiddleware, getIP } from 'better-auth/api';
import type { Logger } from '@daisy/logger';

/** Atomic multi-instance limiter contract backed by @daisy/redis. */
export type AuthRateLimiter = {
  readonly consume: (key: string) => Promise<{
    readonly allowed: boolean;
    readonly retryAfterSeconds: number;
  }>;
};

const magicLinkPath = '/sign-in/magic-link';

// A recipient is personal data: the per-recipient bucket is keyed by its
// SHA3-256 digest so the address never reaches Redis keys or logs.
const digest = (value: string) =>
  createHash('sha3-256').update(value).digest('hex');

const recipientKeys = (path: string, body: unknown) => {
  if (path !== magicLinkPath || typeof body !== 'object' || body === null)
    return [];
  const email: unknown = Reflect.get(body, 'email');
  return typeof email === 'string'
    ? [`auth:magic-link:recipient:${digest(email.trim().toLowerCase())}`]
    : [];
};

const denial = (
  logger: Logger,
  path: string,
  errorCode: 'RATE_LIMIT' | 'INFRASTRUCTURE',
  retryAfterSeconds = 0,
) => {
  // Only the stable route path and code are logged: never the key, client
  // address, request body, or the limiter's raw exception.
  logger.log(
    'http.request.failed',
    { operation: 'auth.rate_limit', path, errorCode },
    errorCode === 'RATE_LIMIT'
      ? 'Auth request rate limited'
      : 'Auth rate limiter unavailable; request denied',
  );
  return errorCode === 'RATE_LIMIT'
    ? new APIError(
        'TOO_MANY_REQUESTS',
        { message: 'Too many requests' },
        { 'Retry-After': String(retryAfterSeconds) },
      )
    : new APIError('SERVICE_UNAVAILABLE', {
        message: 'Service temporarily unavailable',
      });
};

/**
 * ADR 0020 rate-limit gate as a Better Auth `hooks.before` middleware. It
 * runs before every endpoint handler, for HTTP requests and direct
 * `auth.api.*` calls alike, so a denied request performs no durable work.
 * A limiter outage fails closed with a public 503.
 */
export const createRateLimitGate = (dependencies: {
  readonly limiter: AuthRateLimiter;
  readonly logger: Logger;
}) =>
  createAuthMiddleware(async (context) => {
    const { path } = context;
    const client = context.request
      ? getIP(context.request, context.context.options)
      : null;
    const keys = [
      `auth:client:${client ?? 'unknown'}:${path}`,
      ...recipientKeys(path, context.body),
    ];
    // Invoked inside try/await so a limiter that throws synchronously and one
    // that rejects converge on the same fail-closed 503.
    const consume = async (key: string) => {
      try {
        return await dependencies.limiter.consume(key);
      } catch {
        throw denial(dependencies.logger, path, 'INFRASTRUCTURE');
      }
    };
    for (const key of keys) {
      const decision = await consume(key);
      if (!decision.allowed)
        throw denial(
          dependencies.logger,
          path,
          'RATE_LIMIT',
          decision.retryAfterSeconds,
        );
    }
  });
