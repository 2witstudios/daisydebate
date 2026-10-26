import { isAppError } from '@daisy/errors';
import type { ErrorReporter } from '@daisy/observability';

export type MediaMutationOutcome = 'succeeded' | 'failed' | 'unknown';
/**
 * What a provider error proves (ISSUE-464): not found on a delete proves the
 * room is absent, so the deletion holds; any other definite refusal failed;
 * anything else, a network failure, timeout or provider fault, stays unknown.
 */
export function mediaMutationOutcome(
  kind: 'create' | 'delete' | 'permissions',
  error: unknown,
): MediaMutationOutcome {
  if (!isAppError(error)) return 'unknown';
  if (error.code === 'NOT_FOUND' && kind === 'delete') return 'succeeded';
  return error.code === 'NOT_FOUND' || error.code === 'CONFLICT'
    ? 'failed'
    : 'unknown';
}

/** A deadline bounds waiting, never the lifetime of the dispatched provider mutation. */
export async function dispatchMediaMutation(input: {
  readonly persist: () => Promise<string>;
  readonly dispatch: () => Promise<unknown>;
  /** Classifies a provider error; only `unknown` leaves the mutation pending. */
  readonly outcome: (error: unknown) => MediaMutationOutcome;
  readonly settle: (
    id: string,
    outcome: Exclude<MediaMutationOutcome, 'unknown'>,
  ) => Promise<void>;
  readonly unsafe: () => Promise<void>;
  readonly deadline: <T>(work: Promise<T>) => Promise<T>;
  readonly reporter: ErrorReporter;
  readonly requestId: string;
}): Promise<{ readonly acknowledged: boolean }> {
  const id = await input.persist();
  const acknowledgement = Promise.resolve()
    .then(input.dispatch)
    .then(
      () => 'succeeded' as const,
      (error: unknown) => {
        const outcome = input.outcome(error);
        if (outcome === 'unknown') throw error;
        return outcome;
      },
    )
    .then(async (outcome) => {
      await input.settle(id, outcome);
      return outcome;
    });
  try {
    return {
      acknowledged: (await input.deadline(acknowledgement)) === 'succeeded',
    };
  } catch (error) {
    try {
      await input.unsafe();
    } finally {
      input.reporter.capture(error, {
        requestId: input.requestId,
        route: '/api/rounds/:id/media/reconcile',
        errorCode: 'INFRASTRUCTURE',
      });
    }
    return { acknowledged: false };
  }
}
