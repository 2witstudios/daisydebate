import type { JSHandle, Page, Response, TestInfo } from '@playwright/test';
import type { watchConversationRecovery } from './messaging-recovery-evidence';
import { committedRefusalState } from './messaging-committed-refusal';

type RecoveryPhase = {
  readonly phase:
    'unrelated-render-held' | 'after-held-predicate' | 'after-home-predicate';
  readonly response: Response | null;
  readonly previous: string | null;
  readonly previousOwner?: JSHandle<ReturnType<typeof committedRefusalState>>;
  readonly timing?: {
    readonly step: ReturnType<
      ReturnType<typeof watchConversationRecovery>['eventStep']
    >;
    readonly deadline: number;
  };
};

const sameObservedId = (left: string | null, right: string | null) =>
  left === null || right === null ? null : left === right;

/** A private handle is never serialized; callers dispose it within the same journey. */
export const captureRecoveryOwner = (page: Page) =>
  page
    .getByText(
      /^(This conversation could not load\.|This conversation is still unavailable\. Try again\.)$/,
    )
    .evaluateHandle(committedRefusalState, 'private-owner' as const, {
      timeout: 1000,
    });

async function compareRecoveryOwner(
  page: Page,
  previous: NonNullable<RecoveryPhase['previousOwner']>,
) {
  const current = await captureRecoveryOwner(page);
  try {
    return await current.evaluate((now, before) => {
      const left = before.privateOwner;
      const right = now.privateOwner;
      if (!left || !right) return { comparable: false };
      return {
        comparable: true,
        sameRouter: left.router === right.router,
        sameRefresh: left.refresh === right.refresh,
        sameRecovery: left.recovery === right.recovery,
        sameOwnerRef: left.ownerRef === right.ownerRef,
        sameStartTransition: left.startTransition === right.startTransition,
      };
    }, previous);
  } finally {
    await current.dispose();
  }
}

/** One observational DOM read, no wait/retry or protected request. Identifiers stay private. */
export async function recordRecoveryPhase(
  info: TestInfo,
  page: Page,
  observer: ReturnType<typeof watchConversationRecovery>,
  input: RecoveryPhase,
) {
  const status = page.getByText(
    /^(This conversation could not load\.|This conversation is still unavailable\. Try again\.)$/,
  );
  const current =
    (await status.count()) === 1
      ? await status.evaluate(committedRefusalState, true, { timeout: 1000 })
      : null;
  const id = current?.requestId ?? null;
  const selectedId = input.response?.headers()['x-request-id'] ?? null;
  await info.attach('messaging-recovery-phase-safe', {
    contentType: 'application/json',
    body: JSON.stringify({
      phase: input.phase,
      owner: {
        observed: current !== null,
        sameAsPrevious: sameObservedId(id, input.previous),
        sameAsSelectedHttpId: sameObservedId(id, selectedId),
        readiness: current?.diagnostic ?? null,
      },
      lifetime: input.previousOwner
        ? await compareRecoveryOwner(page, input.previousOwner)
        : null,
      requests: observer.snapshot(),
      consumer:
        input.response === null ? null : observer.consumer(input.response),
      requestEvents:
        input.response && input.timing
          ? observer.selectedRequestEvents(
              input.response,
              input.timing.step,
              input.timing.deadline,
            )
          : null,
    }),
  });
}

/** Evidence failure remains visible without replacing the target failure. */
export async function recordRecoveryFailure(
  info: TestInfo,
  page: Page,
  observer: ReturnType<typeof watchConversationRecovery>,
  input: RecoveryPhase,
  target: unknown,
): Promise<never> {
  try {
    await recordRecoveryPhase(info, page, observer, input);
  } catch (diagnostic) {
    throw new AggregateError(
      [target, diagnostic],
      'Messaging predicate and phase evidence failed',
      { cause: target },
    );
  }
  throw target;
}
