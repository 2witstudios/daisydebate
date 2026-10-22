import type { ErrorReporter } from '@daisy/observability';

/** A deadline bounds waiting, never the lifetime of the dispatched provider mutation. */
export async function dispatchMediaMutation(input: {
  readonly persist: () => Promise<string>;
  readonly dispatch: () => Promise<unknown>;
  readonly settle: (id: string) => Promise<void>;
  readonly unsafe: () => Promise<void>;
  readonly deadline: <T>(work: Promise<T>) => Promise<T>;
  readonly reporter: ErrorReporter;
  readonly requestId: string;
}): Promise<{ readonly acknowledged: boolean }> {
  const id = await input.persist();
  const acknowledgement = Promise.resolve()
    .then(input.dispatch)
    .then(() => input.settle(id));
  try {
    await input.deadline(acknowledgement);
    return { acknowledged: true };
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
