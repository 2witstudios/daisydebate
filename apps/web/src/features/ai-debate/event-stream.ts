type Event = { readonly type: string };

const everyHeartbeat = (pulse: () => void): (() => void) => {
  const timer = setInterval(pulse, 2_000);
  return () => clearInterval(timer);
};

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
  heartbeat = everyHeartbeat,
}: {
  /** The source's first result, already read so a refusal maps to a status. */
  readonly first: IteratorResult<T>;
  readonly events: AsyncGenerator<T>;
  readonly abort: () => void;
  readonly onFailure: (error: unknown) => void;
  readonly heartbeat?: (pulse: () => void) => () => void;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);
  let waiting: IteratorResult<T> | null = first;
  let left = false;
  let stopHeartbeat = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Keep the NDJSON connection alive while generation waits for the
      // next segment. A blank line is ignored by the browser's line reader.
      stopHeartbeat = heartbeat(() => {
        if (!left && (controller.desiredSize ?? 0) > 0)
          controller.enqueue(encoder.encode('\n'));
      });
    },
    async pull(controller) {
      try {
        const next = waiting ?? (await events.next());
        waiting = null;
        if (left) return;
        if (next.done) {
          stopHeartbeat();
          controller.enqueue(line({ type: 'done' }));
          controller.close();
        } else controller.enqueue(line(next.value));
      } catch (error) {
        if (left) return;
        stopHeartbeat();
        onFailure(error);
        controller.enqueue(line({ type: 'error' }));
        controller.close();
      }
    },
    async cancel() {
      left = true;
      stopHeartbeat();
      abort();
      await events.return(undefined).catch(() => undefined);
    },
  });
}
