/**
 * The `data` payloads of a server-sent event stream, in order, each as soon
 * as its event is complete. Comments and other fields are skipped; an event
 * left open when the body ends is dropped, since it was never finished.
 */
export async function* sseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let data: string[] = [];
  /** The payloads of the events these whole lines complete. */
  const completed = (lines: readonly string[]) => {
    const payloads: string[] = [];
    for (const line of lines) {
      if (line === '') {
        if (data.length > 0) payloads.push(data.join('\n'));
        data = [];
      } else if (line.startsWith('data:'))
        data.push(line.slice(line[5] === ' ' ? 6 : 5));
    }
    return payloads;
  };
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        // A CR held back as a possible CRLF was a line break after all.
        if (pending.endsWith('\r')) yield* completed([pending.slice(0, -1)]);
        return;
      }
      pending += decoder.decode(next.value, { stream: true });
      // A CR at the very end may be half of a CRLF: it waits for what follows.
      const held = pending.endsWith('\r') ? '\r' : '';
      const lines = pending
        .slice(0, pending.length - held.length)
        .split(/\r\n|\n|\r/);
      // The last piece may still be growing: a line ends only at its break.
      pending = (lines.pop() ?? '') + held;
      yield* completed(lines);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
