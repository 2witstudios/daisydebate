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

/**
 * Which request headers may name the client address. Forwarding headers are
 * client-writable unless a proxy the deployment controls overwrites them, so
 * trust is explicit and the default believes none: every client then shares
 * one bucket per path. That is deliberate until route activation (ADR 0020)
 * configures the deployment's proxy header.
 *
 * A trusted header holding several hops resolves as Better Auth 1.7.5 does:
 * with `trustedProxies` (IPs or CIDR ranges) the chain is walked right to
 * left and the first hop that is not a trusted proxy is the client, so
 * client-forged leftmost entries are never believed; without
 * `trustedProxies` a multi-hop value is not believed at all.
 */
export type ClientIpTrust = {
  readonly trustedHeaders: readonly string[];
  readonly trustedProxies?: readonly string[];
};

/** Maps the trust declaration onto Better Auth's `advanced.ipAddress`. */
export const clientIpOptions = (trust: ClientIpTrust | undefined) => ({
  // An empty list (not undefined) is what stops Better Auth falling back to
  // its default of believing `x-forwarded-for`.
  ipAddressHeaders: [...(trust?.trustedHeaders ?? [])],
  ...(trust?.trustedProxies
    ? { trustedProxies: [...trust.trustedProxies] }
    : {}),
});

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

// A valid hint is rounded up to whole seconds; an invalid one (NaN, negative,
// non-finite) omits the header rather than advertising a made-up wait.
const retryAfterHeaders = (retryAfterSeconds: unknown): HeadersInit =>
  typeof retryAfterSeconds === 'number' &&
  Number.isFinite(retryAfterSeconds) &&
  retryAfterSeconds >= 0
    ? { 'Retry-After': String(Math.ceil(retryAfterSeconds)) }
    : {};

// The limiter is an injected boundary: a decision without a boolean verdict
// is an outage, never an implicit allow and never a TypeError.
const readDecision = (decision: unknown) => {
  if (typeof decision !== 'object' || decision === null)
    throw new TypeError('Malformed limiter decision');
  const allowed: unknown = Reflect.get(decision, 'allowed');
  if (typeof allowed !== 'boolean')
    throw new TypeError('Malformed limiter decision');
  const retryAfterSeconds: unknown = Reflect.get(decision, 'retryAfterSeconds');
  return { allowed, retryAfterSeconds };
};

const denial = (
  logger: Logger,
  path: string,
  errorCode: 'RATE_LIMIT' | 'INFRASTRUCTURE',
  retryAfterSeconds?: unknown,
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
        retryAfterHeaders(retryAfterSeconds),
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
    // Direct `auth.api.*` calls carry no Request, only forwarded Headers.
    const source = context.request ?? context.headers;
    const client = source ? getIP(source, context.context.options) : null;
    const keys = [
      `auth:client:${client ?? 'unknown'}:${path}`,
      ...recipientKeys(path, context.body),
    ];
    // Invoked and validated inside try/await so a limiter that throws
    // synchronously, rejects, or answers nonsense converges on the same
    // fail-closed 503.
    const consume = async (key: string) => {
      try {
        return readDecision(await dependencies.limiter.consume(key));
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
