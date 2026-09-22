import { createAppError } from '@daisy/errors';
import { parseUsername, type Identity } from '@daisy/auth';
import type { UsernameClaim } from '@daisy/db';
import { z } from 'zod';
import { readDecision, type AuthRateLimiter } from '../auth/rate-limit';
import {
  handleOperation,
  parseValidated,
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

/** The two stable 409 answers the onboarding screen tells apart. */
const CONFLICTS = {
  taken: {
    code: 'USERNAME_TAKEN',
    message: 'That username is already taken',
  },
  'already-set': {
    code: 'USERNAME_ALREADY_SET',
    message: 'This account already has a username',
  },
} as const;

const conflict = (kind: keyof typeof CONFLICTS, requestId: string) =>
  Response.json({ error: { ...CONFLICTS[kind], requestId } }, { status: 409 });

/** Gate 4: one atomic decision per account; an outage fails closed. */
async function consumeClaimLimit(limiter: AuthRateLimiter, userId: string) {
  let decision: { readonly allowed: boolean };
  try {
    // A malformed answer is an outage too, exactly as at the auth gate.
    decision = readDecision(
      await limiter.consume(`account:username:${userId}`, CLAIM_RULE),
    );
  } catch (error) {
    throw createAppError('INFRASTRUCTURE', undefined, error);
  }
  if (!decision.allowed) throw createAppError('RATE_LIMIT');
}

/** The body is exactly `{ username }`: any other field is a refusal. */
const claimBody = z.strictObject({ username: z.unknown() });

async function readClaimedName(request: Request): Promise<string> {
  const { username } = parseValidated(claimBody, await readJson(request));
  const parsed = parseUsername(username);
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
    case 'already-set':
      return conflict(outcome.kind, id);
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
      if (identity.state === 'anonymous')
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
