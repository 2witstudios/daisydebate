type Event = { readonly type: string };

/**
 * A source of events as an NDJSON byte stream, read only as the listener
 * asks. It ends with a `done` line, or an `error` line when the source
 * fails (reported once through `onFailure`). When the listener leaves,
 * `abort` stops the work behind the source and the source is ended, with
 * nothing reported as a failure.
 */
export function eventStream<T extends Event>({
  first,
  events,
  abort,
  onFailure,
}: {
  /** The source's first result, already read so a refusal maps to a status. */
  readonly first: IteratorResult<T>;
  readonly events: AsyncGenerator<T>;
  readonly abort: () => void;
  readonly onFailure: (error: unknown) => void;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);
  let waiting: IteratorResult<T> | null = first;
  let left = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = waiting ?? (await events.next());
        waiting = null;
        if (left) return;
        if (next.done) {
          controller.enqueue(line({ type: 'done' }));
          controller.close();
        } else controller.enqueue(line(next.value));
      } catch (error) {
        if (left) return;
        onFailure(error);
        controller.enqueue(line({ type: 'error' }));
        controller.close();
      }
    },
    async cancel() {
      left = true;
      abort();
      await events.return(undefined).catch(() => undefined);
    },
  });
}
