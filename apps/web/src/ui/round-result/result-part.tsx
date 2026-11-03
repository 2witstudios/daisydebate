type ReadFailure = 'temporary' | 'lasting';

/** A part of the result: what was read, and how its read failed, if it did. */
export type ResultPart<T> = {
  readonly value: T | null;
  readonly failure: ReadFailure | null;
};

/**
 * Keeps "nothing to show" apart from "not read": a reader with no part in this
 * result gets `missing`, and a failed read must never look like that (ISSUE-1150).
 */
export function resultPart<
  R extends { readonly kind: string; readonly temporary?: true },
  T,
>(
  read: R,
  found: (read: Extract<R, { readonly kind: 'found' }>) => T,
): ResultPart<T> {
  if (read.kind === 'found')
    return {
      value: found(read as Extract<R, { readonly kind: 'found' }>),
      failure: null,
    };
  if (read.kind !== 'unavailable') return { value: null, failure: null };
  return { value: null, failure: read.temporary ? 'temporary' : 'lasting' };
}

/**
 * What the page does about its parts. It refreshes only when every failure can
 * pass: one that may never pass would reload the page forever.
 */
export const resultRetryOf = (
  parts: readonly Pick<ResultPart<unknown>, 'failure'>[],
): 'refresh' | 'reload' | null => {
  const failures = parts.map(({ failure }) => failure);
  if (failures.includes('lasting')) return 'reload';
  return failures.includes('temporary') ? 'refresh' : null;
};

/**
 * Part of a finished Round's result was not read. With `retrySeconds`, a plain
 * refresh brings it back with or without script, always as a GET, and applies
 * every rule again; without it, asking again is the reader's choice.
 */
export function ResultUnavailable({
  retrySeconds,
}: {
  readonly retrySeconds: number | null;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-xl bg-surface p-6 shadow-1">
      {retrySeconds === null ? null : (
        <meta httpEquiv="refresh" content={String(retrySeconds)} />
      )}
      <p role="status">
        {retrySeconds === null
          ? 'Part of this result could not load.'
          : 'Part of this result could not load. Trying again.'}
      </p>
      <a className="font-strong underline" href="">
        Try now
      </a>
    </section>
  );
}
