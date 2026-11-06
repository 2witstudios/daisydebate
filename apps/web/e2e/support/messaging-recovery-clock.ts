import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { systemClock } from '@daisy/clock';
import { boundedStep } from './bounded-step';
import { committedRefusalRenderId } from './messaging-committed-refusal';
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
  await expect
    .poll(
      async () => {
        id = await status(page).evaluate(committedRefusalRenderId, true);
        return id !== null;
      },
      { timeout: Math.min(5000, remaining(deadline)) },
    )
    .toBe(true);
  return id!;
}

/** One actual response must finish and commit its own refusal before another deadline. */
export async function settledRefusalResponse(
  page: Page,
  observer: ReturnType<typeof watchConversationRecovery>,
  attempt: number,
  previous: string,
  deadline: number,
) {
  await expect
    .poll(() => observer.refetchResponses().length, {
      timeout: Math.min(5000, remaining(deadline)),
    })
    .toBe(attempt);
  const response = observer.refetchResponses()[attempt - 1]!;
  const payload = await boundedStep(
    'the completed actual refusal response',
    async () => {
      const error = await response.finished();
      if (error) throw error;
      return response.text();
    },
    remaining(deadline),
  );
  const advice = advisedConversationBoundary(payload);
  expect(advice !== null).toBe(true);
  let id: string | null = null;
  await expect
    .poll(
      async () => {
        id = await status(page).evaluate(committedRefusalRenderId, true);
        return (
          id !== null &&
          id !== previous &&
          id === advice!.requestId &&
          observer.snapshot().pending === 0
        );
      },
      { timeout: Math.min(5000, remaining(deadline)) },
    )
    .toBe(true);
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
