import { idSchema } from '@daisy/protocol';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import type { Clock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import type { Identity } from '@daisy/auth';
import { memberFloorDecision, type AgeRefusal } from '@daisy/auth/age-floor';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { consumeOrThrow, type RateLimiter } from '../../server/rate-limit';
import {
  handleOperation,
  parseValidated,
  readJson,
  requireSameOrigin,
  requireSignedIn,
} from '../../server/http';

/** A person correcting a slip, far below anything that probes the floor. */
const AGE_RULE = { windowSeconds: 60, max: 10 } as const;

/** The refusal a browser is held to for a day after an under-13 answer (WAIT-4.7). */
export type { AgeRefusal };

/** Holds only which refusal was given; it identifies no one. */
export const AGE_HOLD_COOKIE = '__Host-daisy-age-held';
const HOLD_SECONDS = 24 * 60 * 60;

/**
 * A hold cookie's value as the refusal it holds, or null for anything else.
 * A day-old `below-floor` hold from the beta's 16 floor holds nothing now:
 * that answer is admitted at 13 (decision 88).
 */
export const holdRefusal = (value: string | undefined): AgeRefusal | null =>
  value === 'under-13' ? value : null;

/** The hold a browser carries, read from its own cookie header. */
const heldRefusal = (cookieHeader: string | null): AgeRefusal | null =>
  holdRefusal(
    new RegExp(`(?:^|;\\s*)${AGE_HOLD_COOKIE}=([a-z0-9-]+)`).exec(
      cookieHeader ?? '',
    )?.[1],
  );

/**
 * The hold's one definition (WAIT-4.7): Secure, httpOnly, Lax, one day at
 * the root. The route writes it as its Set-Cookie line and the form action
 * passes it to cookies().set, so the two cannot drift.
 */
export const AGE_HOLD_COOKIE_OPTIONS = {
  path: '/',
  maxAge: HOLD_SECONDS,
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
} as const;

/** The Set-Cookie line for a refusal, from the hold's one definition. */
const holdCookie = (refusal: AgeRefusal): string => {
  // The hold is always Secure and HttpOnly (both literally `true` above).
  const { path, maxAge, sameSite } = AGE_HOLD_COOKIE_OPTIONS;
  return [
    `${AGE_HOLD_COOKIE}=${refusal}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    'Secure',
    'HttpOnly',
    `SameSite=${sameSite[0]!.toUpperCase()}${sameSite.slice(1)}`,
  ].join('; ');
};

type AgeStepDependencies = {
  readonly logger: Logger;
  /** ADR 0037: where a 5xx from this handler's raw error goes, scrubbed. */
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  /** Principal resolution from the request's cookies only. */
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: () => RateLimiter;
  readonly clock: Clock;
  readonly termsVersion: string;
  readonly parentalControls?: {
    readonly released: (userId: string) => Promise<boolean>;
    readonly binding: (
      userId: string,
      now: string,
    ) => Promise<{
      readonly requestId: string;
      readonly birthMonth: string;
    } | null>;
  };
  readonly record: (input: {
    readonly userId: string;
    readonly birthMonth: string;
    readonly parentalControls?: {
      readonly linkId: string;
      readonly pendingBetaEventId: string;
      readonly requestId: string | null;
    };
    readonly termsVersion: string;
    readonly now: string;
  }) => Promise<'recorded' | 'already-recorded'>;
  /** Deletes the provisional account that gave an under-age answer, unless it already answered. */
  readonly forget: (userId: string) => Promise<'deleted' | 'refused'>;
};

/** Exactly a month, a year and the Terms acceptance: nothing else, never an age. */
const ageBody = z.union([
  z.strictObject({
    month: z.int().min(1).max(12),
    year: z.int().min(1900).max(9999),
    terms: z.literal(true),
  }),
  z.strictObject({ invitationId: idSchema, terms: z.literal(true) }),
]);

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
 * the browser to the same refusal for a day. A held browser gets that
 * refusal again, and its new provisional account is deleted the same way.
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
        await consumeOrThrow(
          dependencies.limiter(),
          `account:age:${userId}`,
          AGE_RULE,
        );
        const held = heldRefusal(request.headers.get('cookie'));
        if (held !== null) {
          // ISSUE-660: a held browser that signed up again keeps no new
          // account. One that already answered is kept and its first answer
          // stands: a conflict, as below, never a fresh hold.
          if ((await dependencies.forget(userId)) === 'refused')
            throw createAppError('CONFLICT');
          return refused(held, id);
        }
        const answer = parseValidated(ageBody, await readJson(request));
        const now = dependencies.clock.now();
        const parentalControls = (await dependencies.parentalControls?.released(
          userId,
        ))
          ? dependencies.parentalControls
          : undefined;
        const binding = await parentalControls?.binding(userId, now);
        const submittedRequest =
          'invitationId' in answer ? answer.invitationId : null;
        if ((binding?.requestId ?? null) !== submittedRequest)
          throw createAppError('VALIDATION');
        const birthMonth =
          binding?.birthMonth ??
          ('month' in answer
            ? `${answer.year}-${String(answer.month).padStart(2, '0')}`
            : null);
        if (birthMonth === null) throw createAppError('VALIDATION');
        const decision = memberFloorDecision(birthMonth, new Date(now));
        if (decision.outcome === 'refused') {
          // Refused means the account answered already or became a member:
          // the first answer stands, so no refusal page and no hold.
          if ((await dependencies.forget(userId)) === 'refused')
            throw createAppError('CONFLICT');
          return refused(decision.refusal, id);
        }
        const outcome = await dependencies.record({
          userId,
          birthMonth,
          ...(parentalControls
            ? {
                parentalControls: {
                  linkId: createId(),
                  pendingBetaEventId: createId(),
                  requestId: binding?.requestId ?? null,
                },
              }
            : {}),
          termsVersion: dependencies.termsVersion,
          now,
        });
        return Response.json({ recorded: outcome });
      },
      dependencies.reporter,
    );
}
