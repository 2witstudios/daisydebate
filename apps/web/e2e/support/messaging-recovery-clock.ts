import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { systemClock } from '@daisy/clock';
import { boundedStep } from './bounded-step';
import { committedRefusalState } from './messaging-committed-refusal';
import { advisedConversationBoundary } from './messaging-refusal-flight';
import type { watchConversationRecovery } from './messaging-recovery-evidence';

export async function pauseMessagingRecovery(page: Page) {
  const anchor = new Date(systemClock.now());
  await page.clock.install();
  await page.clock.setFixedTime(anchor);
  await page.clock.pauseAt(anchor);
  await page.clock.setSystemTime(anchor);
}

export const recoveryDeadline = () => Date.parse(systemClock.now()) + 10000;
const remaining = (deadline: number) => {
  const budget = deadline - Date.parse(systemClock.now());
  if (budget <= 0)
    throw new Error('Messaging recovery proof exceeded its existing10s budget');
  return budget;
};
const status = (page: Page) =>
  page.getByText(
    /^(This conversation could not load\.|This conversation is still unavailable\. Try again\.)$/,
  );

export async function settledRefusal(page: Page, deadline: number) {
  let id: string | null = null;
  let readiness: ReturnType<typeof committedRefusalState>['diagnostic'] | null =
    null;
  const failures: unknown[] = [];
  try {
    await expect
      .poll(
        async () => {
          const observed = await status(page).evaluate(
            committedRefusalState,
            true,
          );
          id = observed.requestId;
          readiness = observed.diagnostic;
          return id !== null;
        },
        { timeout: Math.min(5000, remaining(deadline)) },
      )
      .toBe(true);
  } catch (error) {
    failures.push(error);
  }
  try {
    await test.info().attach('initial-refusal-readiness-safe', {
      contentType: 'application/json',
      body: JSON.stringify({
        phase: 'initial',
        observed: readiness !== null,
        readiness,
      }),
    });
  } catch (diagnosticError) {
    failures.push(diagnosticError);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      'Refusal predicate and diagnostic attachment failed',
      { cause: failures[0] },
    );
  return id!;
}

/** One actual response must finish and commit the newest refusal before another deadline. */
export async function settledRefusalResponse(
  page: Page,
  observer: ReturnType<typeof watchConversationRecovery>,
  attempt: number,
  previous: string,
  deadline: number,
  expectedId?: string,
) {
  await expect
    .poll(() => observer.refetchResponses().length, {
      timeout: Math.min(5000, remaining(deadline)),
    })
    .toBe(attempt);
  const response = observer.refetchResponses()[attempt - 1]!;
  const eventStep = observer.eventStep();
  const pendingAtEntry = observer.snapshot().pending;
  const budgetMs = remaining(deadline);
  let payload: string | undefined;
  const completionFailures: unknown[] = [];
  try {
    const controlled = observer.controlledPayload(response);
    if (controlled === null)
      throw new Error('Missing actual controlled refusal bytes');
    // Chromium can report ERR_ABORTED after the decoder has consumed EOF.
    // Playwright1.63 never resolves Response.finished() on requestfailed.
    // Prove the exact fetched bytes at the real decoder instead of accepting
    // either the network abort or an uncorrelated EOF as completion.
    await expect
      .poll(() => observer.consumer(response), {
        timeout: budgetMs,
        intervals: [0, 20, 50, 100],
      })
      .toMatchObject({
        sameHttpCorrelation: true,
        readerOpened: true,
        eof: true,
        bytesMatch: true,
        readRejected: false,
        readerCancelled: false,
        bodyCancelled: false,
        signalAborted: false,
        byteLimitExceeded: false,
        digestFailed: false,
      });
    payload = controlled;
  } catch (error) {
    completionFailures.push(error);
  }
  try {
    await test.info().attach('refusal-consumption-safe', {
      contentType: 'application/json',
      body: JSON.stringify({
        phase: 'exact-consumer-completion',
        attempt,
        budgetMs,
        pendingAtEntry,
        pendingAtExit: observer.snapshot().pending,
        maximumPendingWholeObservation: observer.snapshot().maximumPending,
        consumer: observer.consumer(response),
        selectedRequestEvents: observer.selectedRequestEvents(
          response,
          eventStep,
          deadline,
        ),
      }),
    });
  } catch (diagnosticError) {
    completionFailures.push(diagnosticError);
  }
  if (completionFailures.length === 1) throw completionFailures[0];
  if (completionFailures.length > 1)
    throw new AggregateError(
      completionFailures,
      'Response completion and diagnostic attachment failed',
      { cause: completionFailures[0] },
    );
  const advice = advisedConversationBoundary(payload!);
  expect(advice !== null).toBe(true);
  // Next reconciles concurrent RSC payloads: when an unrelated action render
  // commits while a refresh is in flight, the stale refresh payload is
  // discarded and the newest committed render (expectedId, here the action
  // render's own refusal) is the settlement. Otherwise the held response's
  // own advice is the settlement.
  const expected = expectedId ?? advice!.requestId;
  let id: string | null = null;
  let readiness: ReturnType<typeof committedRefusalState>['diagnostic'] | null =
    null;
  let settledIdentityMatchesResponse = false;
  const failures: unknown[] = [];
  try {
    await expect
      .poll(
        async () => {
          const observed = await status(page).evaluate(
            committedRefusalState,
            true,
          );
          id = observed.requestId;
          readiness = observed.diagnostic;
          settledIdentityMatchesResponse =
            id !== null && id === advice!.requestId;
          return (
            id !== null &&
            id !== previous &&
            id === expected &&
            observer.snapshot().pending === 0
          );
        },
        { timeout: Math.min(5000, remaining(deadline)) },
      )
      .toBe(true);
  } catch (error) {
    failures.push(error);
  }
  try {
    await test.info().attach('completed-refusal-readiness-safe', {
      contentType: 'application/json',
      body: JSON.stringify({
        phase: 'completed-response',
        attempt,
        exactResponseConsumed: true,
        settledIdentityMatchesResponse,
        observed: readiness !== null,
        readiness,
      }),
    });
  } catch (diagnosticError) {
    failures.push(diagnosticError);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      'Refusal predicate and diagnostic attachment failed',
      { cause: failures[0] },
    );
  expect(observer.snapshot()).toMatchObject({
    dispatches: attempt,
    maximumPending: 1,
    pending: 0,
  });
  return id!;
}

/** Advance only the next declared backoff, with all work inside the prior10s budget. */
export async function driveRefusalDeadlines(
  page: Page,
  observer: ReturnType<typeof watchConversationRecovery>,
  previous: string,
  deadline: number,
  fromAttempt = 0,
) {
  let id = previous;
  for (const attempt of [1, 2, 3].slice(fromAttempt)) {
    await boundedStep(
      'the next declared Messaging backoff',
      () => page.clock.fastForward(1000 * 2 ** (attempt - 1)),
      remaining(deadline),
    );
    id = await settledRefusalResponse(page, observer, attempt, id, deadline);
  }
  await expect(
    page.getByText('This conversation is still unavailable. Try again.', {
      exact: true,
    }),
  ).toBeVisible({ timeout: remaining(deadline) });
}
