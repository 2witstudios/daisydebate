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
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      pending += decoder.decode(next.value, { stream: true });
      const lines = pending.split(/\r\n|\n|\r/);
      // The last piece may still be growing: a line ends only at its break.
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line === '') {
          if (data.length > 0) yield data.join('\n');
          data = [];
        } else if (line.startsWith('data:'))
          data.push(line.slice(line[5] === ' ' ? 6 : 5));
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
