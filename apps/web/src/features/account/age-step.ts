import type { Logger } from '@daisy/logger';
import type { Clock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { ageBand, type Identity } from '@daisy/auth';
import {
  ageStepDecision,
  type AgeFloor,
  type AgeStepDecision,
} from '@daisy/auth/age-floor';
import { z } from 'zod';
import { consumeOrThrow, type AuthRateLimiter } from '../auth/abuse/rate-limit';
import {
  handleOperation,
  parseValidated,
  readJson,
  requireSameOrigin,
  requireSignedIn,
} from '../../server/http';

/** A person correcting a slip, far below anything that probes the floor. */
const AGE_RULE = { windowSeconds: 60, max: 10 } as const;

/** The refusal a browser is held to for a day after an under-age answer (WAIT-4.7). */
export type AgeRefusal = Exclude<AgeStepDecision, 'accept'>;

/** Holds only which refusal was given; it identifies no one. */
export const AGE_HOLD_COOKIE = '__Host-daisy-age-held';
const HOLD_SECONDS = 24 * 60 * 60;

/** The hold a browser carries, read from its own cookie header. */
export function heldRefusal(cookieHeader: string | null): AgeRefusal | null {
  const cookie = cookieHeader ?? '';
  const value = new RegExp(`(?:^|;\\s*)${AGE_HOLD_COOKIE}=([a-z0-9-]+)`).exec(
    cookie,
  )?.[1];
  return value === 'under-13' || value === 'below-floor' ? value : null;
}

/** How long a refusal holds its browser (WAIT-4.7). */
export const AGE_HOLD_SECONDS = HOLD_SECONDS;

/** The Set-Cookie line for a refusal: Secure, httpOnly, Lax, one day. */
const holdCookie = (refusal: AgeRefusal): string =>
  `${AGE_HOLD_COOKIE}=${refusal}; Path=/; Max-Age=${HOLD_SECONDS}; Secure; HttpOnly; SameSite=Lax`;

type AgeStepDependencies = {
  readonly logger: Logger;
  readonly origin: () => string;
  /** Principal resolution from the request's cookies only. */
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: () => AuthRateLimiter;
  readonly clock: Clock;
  /** The one trusted floor (`ACCOUNT_AGE_FLOOR`), injected. */
  readonly floor: AgeFloor;
  readonly termsVersion: string;
  readonly record: (input: {
    readonly userId: string;
    readonly birthMonth: string;
    readonly termsVersion: string;
    readonly now: string;
  }) => Promise<'recorded' | 'already-recorded'>;
  /** Deletes the provisional account that gave an under-age answer, unless it already answered. */
  readonly forget: (userId: string) => Promise<'deleted' | 'refused'>;
};

/** Exactly a month, a year and the Terms acceptance: nothing else, never an age. */
const ageBody = z.strictObject({
  month: z.int().min(1).max(12),
  year: z.int().min(1900).max(9999),
  terms: z.literal(true),
});

const refused = (refusal: AgeRefusal, requestId: string) =>
  Response.json(
    { error: { code: 'AGE_REFUSED', refusal, requestId } },
    { status: 403, headers: { 'set-cookie': holdCookie(refusal) } },
  );

/**
 * POST /api/account/age, the age step (WAIT-4.6, WAIT-4.7, DEC-244). Gate
 * order is ADR 0020: same origin, the session's own account (a signed-in
 * account without a username), an atomic rate limit, a strict body, then
 * durable work. The server bands the birth month with its own clock: at or
 * above the floor it stores the month and the Terms version together;
 * below it, it stores nothing, deletes the provisional account and holds
 * the browser to the same refusal for a day.
 */
export function createAgeStepHandler(dependencies: AgeStepDependencies) {
  return (request: Request) =>
    handleOperation(
      dependencies.logger,
      request,
      'account.age.answer',
      async (id) => {
        requireSameOrigin(request, dependencies.origin());
        const identity = requireSignedIn(await dependencies.identify(request));
        if (identity.state !== 'provisional')
          throw createAppError('AUTHORIZATION');
        const { userId } = identity.principal;
        const held = heldRefusal(request.headers.get('cookie'));
        if (held !== null) return refused(held, id);
        await consumeOrThrow(
          dependencies.limiter(),
          `account:age:${userId}`,
          AGE_RULE,
        );
        const { month, year } = parseValidated(
          ageBody,
          await readJson(request),
        );
        const birthMonth = `${year}-${String(month).padStart(2, '0')}`;
        const now = dependencies.clock.now();
        const decision = ageStepDecision(
          ageBand(birthMonth, new Date(now)),
          dependencies.floor,
        );
        if (decision !== 'accept') {
          // Refused means the account answered already or became a member:
          // the first answer stands, so no refusal page and no hold.
          if ((await dependencies.forget(userId)) === 'refused')
            throw createAppError('CONFLICT');
          return refused(decision, id);
        }
        const outcome = await dependencies.record({
          userId,
          birthMonth,
          termsVersion: dependencies.termsVersion,
          now,
        });
        return Response.json({ recorded: outcome });
      },
    );
}
