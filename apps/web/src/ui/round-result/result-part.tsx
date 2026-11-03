/** A part of the result: what was read, and whether a read failed for it. */
export type ResultPart<T> = {
  readonly value: T | null;
  readonly unavailable: boolean;
};

/**
 * Keeps "nothing to show" apart from "not read": a reader with no part in this
 * result gets `missing`, and a failed read must never look like that (ISSUE-1150).
 */
export function resultPart<R extends { readonly kind: string }, T>(
  read: R,
  found: (read: Extract<R, { readonly kind: 'found' }>) => T,
): ResultPart<T> {
  return read.kind === 'found'
    ? {
        value: found(read as Extract<R, { readonly kind: 'found' }>),
        unavailable: false,
      }
    : { value: null, unavailable: read.kind === 'unavailable' };
}

/**
 * Part of a finished Round's result was not read. A plain refresh brings it
 * back with or without script, always as a GET, and applies every rule again.
 */
export function ResultRetry({
  retrySeconds,
}: {
  readonly retrySeconds: number;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-xl bg-surface p-6 shadow-1">
      <meta httpEquiv="refresh" content={String(retrySeconds)} />
      <p role="status">Part of this result could not load. Trying again.</p>
      <a className="font-strong underline" href="">
        Try now
      </a>
    </section>
  );
}
