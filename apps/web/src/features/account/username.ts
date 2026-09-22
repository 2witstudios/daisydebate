import { createAppError } from '@daisy/errors';
import { parseUsername, type Identity } from '@daisy/auth';
import type { UsernameClaim } from '@daisy/db';
import type { AuthRateLimiter } from '../auth/rate-limit';
import {
  handleOperation,
  readJson,
  requireSameOrigin,
} from '../../server/http';

/** Enough for a person retrying a typo; far below what enumerates names. */
const CLAIM_RULE = { windowSeconds: 60, max: 10 } as const;

type UsernameDependencies = {
  readonly origin: () => string;
  /** Principal resolution from the request's cookies only. */
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: () => AuthRateLimiter;
  readonly claim: (input: {
    userId: string;
    username: string;
  }) => Promise<UsernameClaim>;
};

const conflict = (
  code: 'USERNAME_TAKEN' | 'USERNAME_ALREADY_SET',
  id: string,
) =>
  Response.json(
    {
      error: {
        code,
        message:
          code === 'USERNAME_TAKEN'
            ? 'That username is already taken'
            : 'This account already has a username',
        requestId: id,
      },
    },
    { status: 409 },
  );

/** Gate 4: one atomic decision per account; an outage fails closed. */
async function consumeClaimLimit(limiter: AuthRateLimiter, userId: string) {
  let decision: { readonly allowed: boolean };
  try {
    decision = await limiter.consume(`account:username:${userId}`, CLAIM_RULE);
  } catch (error) {
    throw createAppError('INFRASTRUCTURE', undefined, error);
  }
  if (!decision.allowed) throw createAppError('RATE_LIMIT');
}

/** The body is exactly `{ username }`: any other field is a refusal. */
async function readClaimedName(request: Request): Promise<string> {
  const body = await readJson(request);
  const keys =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? Object.keys(body)
      : [];
  if (keys.length !== 1 || keys[0] !== 'username')
    throw createAppError('VALIDATION');
  const parsed = parseUsername((body as { username: unknown }).username);
  if (!parsed.ok) throw createAppError('VALIDATION');
  return parsed.username;
}

const respond = (
  outcome: UsernameClaim,
  username: string,
  id: string,
): Response => {
  switch (outcome.kind) {
    case 'claimed':
      return Response.json({ username }, { status: 201 });
    case 'unchanged':
      return Response.json({ username });
    case 'taken':
      return conflict('USERNAME_TAKEN', id);
    case 'already-set':
      return conflict('USERNAME_ALREADY_SET', id);
    case 'unknown-user':
      throw createAppError('AUTHENTICATION');
  }
};

/**
 * POST /api/account/username: the only way an account acquires a username.
 * Gate order is ADR 0020: route (same origin), Principal (session cookie),
 * authorization (a signed-in user, never a body-supplied id), atomic rate
 * limit, and only then durable work. The body is exactly `{ username }`.
 */
export function createUsernameHandler(dependencies: UsernameDependencies) {
  return (request: Request) =>
    handleOperation(request, 'account.username.claim', async (id) => {
      requireSameOrigin(request, dependencies.origin());
      const identity = await dependencies.identify(request);
      // A session-store outage is retryable, not "your sign-in ended".
      if (identity.state === 'unavailable')
        throw createAppError('INFRASTRUCTURE');
      if (identity.principal.kind !== 'user')
        throw createAppError('AUTHENTICATION');
      const { userId } = identity.principal;
      await consumeClaimLimit(dependencies.limiter(), userId);
      const username = await readClaimedName(request);
      return respond(
        await dependencies.claim({ userId, username }),
        username,
        id,
      );
    });
}
