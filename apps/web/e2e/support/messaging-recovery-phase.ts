import type { Page, Response, TestInfo } from '@playwright/test';
import type { watchConversationRecovery } from './messaging-recovery-evidence';
import { committedRefusalState } from './messaging-committed-refusal';

type RecoveryPhase = {
  readonly phase:
    'unrelated-render-held' | 'after-held-predicate' | 'after-home-predicate';
  readonly response: Response | null;
  readonly previous: string | null;
  readonly timing?: {
    readonly step: ReturnType<
      ReturnType<typeof watchConversationRecovery>['eventStep']
    >;
    readonly deadline: number;
  };
};

const sameObservedId = (left: string | null, right: string | null) =>
  left === null || right === null ? null : left === right;

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
