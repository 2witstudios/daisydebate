import type { Logger } from '@daisy/logger';
import type { Clock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import type { Identity } from '@daisy/auth';
import type { OnboardingStepWrite } from '@daisy/db/profile';
import { consumeOrThrow, type AuthRateLimiter } from '../auth/abuse/rate-limit';
import {
  handleOperation,
  readJson,
  requireSameOrigin,
  requireSignedIn,
} from '../../server/http';
import { parseStepAnswers } from './answers';

/** A member clicking through six steps, with room for going back. */
const SAVE_RULE = { windowSeconds: 60, max: 30 } as const;

type OnboardingDependencies = {
  readonly logger: Logger;
  readonly origin: () => string;
  /** Principal resolution from the request's cookies only. */
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: () => AuthRateLimiter;
  readonly clock: Clock;
  /**
   * Stores one step for the session's own account, refusing (AUTHORIZATION,
   * nothing stored) unless its canonical age fact admits optional answers,
   * read under the account fence in the write's own transaction (ISSUE-645).
   */
  readonly save: (input: {
    readonly userId: string;
    readonly actorId: string;
    readonly answers: OnboardingStepWrite;
    readonly now: string;
  }) => Promise<void>;
  readonly complete: (userId: string, at: Date) => Promise<void>;
};

/** The session's member ids, refusing anyone without a username. */
async function memberIds(
  identify: (request: Request) => Promise<Identity>,
  request: Request,
): Promise<{ readonly userId: string; readonly actorId: string | null }> {
  const identity = requireSignedIn(await identify(request));
  if (identity.state !== 'member') throw createAppError('AUTHORIZATION');
  return identity.principal;
}

const isFinish = (body: unknown) =>
  typeof body === 'object' &&
  body !== null &&
  !Array.isArray(body) &&
  (body as { step?: unknown }).step === 'finish';

/**
 * POST /api/account/onboarding: saves one questionnaire step, or records
 * that the member finished (Finish or Skip). Gate order is ADR 0020: same
 * origin, the session Principal, a member with a username (never a
 * body-supplied id), an atomic rate limit, a strict body, and only then
 * durable work. Optional answers also need the member's canonical age
 * fact to admit them (16 or over, DEC-106); the body never carries an age.
 * A refused answer stores nothing; Finish needs no age.
 */
export function createOnboardingHandler(dependencies: OnboardingDependencies) {
  return (request: Request) =>
    handleOperation(
      dependencies.logger,
      request,
      'account.onboarding.save',
      async () => {
        requireSameOrigin(request, dependencies.origin());
        const { userId, actorId } = await memberIds(
          dependencies.identify,
          request,
        );
        await consumeOrThrow(
          dependencies.limiter(),
          `account:onboarding:${userId}`,
          SAVE_RULE,
        );
        const body = await readJson(request);
        if (isFinish(body)) {
          if (Object.keys(body as object).length !== 1)
            throw createAppError('VALIDATION');
          await dependencies.complete(
            userId,
            new Date(dependencies.clock.now()),
          );
          return Response.json({ saved: 'finish' });
        }
        const parsed = parseStepAnswers(body);
        if (!parsed.ok) throw createAppError('VALIDATION');
        if (actorId === null) throw createAppError('AUTHORIZATION');
        await dependencies.save({
          userId,
          actorId,
          answers: parsed.value,
          now: dependencies.clock.now(),
        });
        return Response.json({ saved: parsed.value.step });
      },
    );
}
