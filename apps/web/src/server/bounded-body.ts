/**
 * Reads a request body incrementally and cancels the stream the moment it
 * exceeds `maxBytes`, so chunked or understated-Content-Length bodies are
 * never buffered whole. Returns null when the cap is exceeded.
 */
async function readChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer | null> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (signal.aborted) return null;
    if (done) return Buffer.concat(chunks);
    length += value.length;
    if (length > maxBytes) return null;
    chunks.push(value);
  }
}

export async function readBoundedBody(
  request: Request,
  maxBytes: number,
  signal: AbortSignal = request.signal,
): Promise<Buffer | null> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes)
    return null;
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const cancel = () => {
    // A peer-controlled underlying cancel promise must not extend our read deadline.
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) {
      cancel();
      return null;
    }
    const body = await readChunks(reader, maxBytes, signal);
    if (body === null) cancel();
    return body;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
