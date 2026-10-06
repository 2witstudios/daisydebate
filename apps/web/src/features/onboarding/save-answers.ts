import type { Logger } from '@daisy/logger';
import type { Clock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import type { Identity } from '@daisy/auth';
import type { OnboardingStepWrite } from '@daisy/db';
import { consumeOrThrow, type AuthRateLimiter } from '../auth/rate-limit';
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
  readonly save: (
    userId: string,
    answers: OnboardingStepWrite,
  ) => Promise<void>;
  readonly complete: (userId: string, at: Date) => Promise<void>;
};

/** The session's member id, refusing anyone without a username. */
async function memberId(
  identify: (request: Request) => Promise<Identity>,
  request: Request,
): Promise<string> {
  const identity = requireSignedIn(await identify(request));
  if (identity.state !== 'member') throw createAppError('AUTHORIZATION');
  return identity.principal.userId;
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
 * durable work. A refused answer stores nothing.
 */
export function createOnboardingHandler(dependencies: OnboardingDependencies) {
  return (request: Request) =>
    handleOperation(
      dependencies.logger,
      request,
      'account.onboarding.save',
      async () => {
        requireSameOrigin(request, dependencies.origin());
        const userId = await memberId(dependencies.identify, request);
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
        await dependencies.save(userId, parsed.value);
        return Response.json({ saved: parsed.value.step });
      },
    );
}
