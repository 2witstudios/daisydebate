import { createAppError, toPublicError } from '@daisy/errors';
import {
  currentTraceId,
  extractTraceContext,
  requestId,
  withSpan,
} from '@daisy/observability';
import type { Logger } from '@daisy/logger';
import { type ZodType } from 'zod';
import { getResources } from './resources';

/** Single trust-boundary entry for untrusted payloads; failures map to VALIDATION. */
export function parseValidated<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw createAppError('VALIDATION', undefined, result.error);
  return result.data;
}
export async function handleOperation(
  request: Request,
  operation: string,
  handler: (id: string, logger: Logger) => Promise<Response>,
): Promise<Response> {
  const id = requestId(request.headers.get('x-request-id'));
  const start = performance.now();
  return withSpan(
    operation,
    { 'request.id': id },
    async () => {
      let logger: Logger | undefined;
      try {
        // Construction failures must map through the public error contract too.
        logger = getResources().logger.child({
          requestId: id,
          traceId: currentTraceId(),
          operation,
        });
        request.signal.throwIfAborted();
        const response = await handler(id, logger);
        response.headers.set('x-request-id', id);
        response.headers.set('Cache-Control', 'no-store');
        logger.log(
          'http.request.completed',
          {
            durationMs: Math.round(performance.now() - start),
            status: response.status,
          },
          'Request completed',
        );
        return response;
      } catch (error) {
        // Client cancellation is expected traffic, not a failure signal.
        if (request.signal.aborted) {
          logger?.log(
            'http.request.cancelled',
            {
              durationMs: Math.round(performance.now() - start),
              errorCode: 'REQUEST_CANCELLED',
            },
            'Request cancelled before completion',
          );
          return new Response(null, {
            status: 499,
            headers: { 'x-request-id': id, 'Cache-Control': 'no-store' },
          });
        }
        const mapped = toPublicError(error, id);
        if (mapped.body.error.invariantId !== undefined)
          logger?.log(
            'invariant.violated',
            { invariantId: mapped.body.error.invariantId },
            'Invariant violated',
          );
        logger?.log(
          'http.request.failed',
          {
            durationMs: Math.round(performance.now() - start),
            errorCode: mapped.body.error.code,
          },
          'Request failed',
        );
        return Response.json(mapped.body, {
          status: mapped.status,
          headers: { 'x-request-id': id, 'Cache-Control': 'no-store' },
        });
      }
    },
    extractTraceContext(request.headers),
  );
}
/**
 * Fail-closed origin gate for state changes. The Origin must be this app's,
 * with one browser case: a form posted from a page served with
 * `Referrer-Policy: no-referrer` (the emailed-link confirmation) carries
 * `Origin: null` even to its own origin. That is accepted only with
 * `Sec-Fetch-Site: same-origin`, which page script cannot set and which a
 * sandboxed or cross-site sender never reports.
 */
export function requireSameOrigin(request: Request, origin: string) {
  const claimed = request.headers.get('origin');
  if (claimed === new URL(origin).origin) return;
  if (
    claimed === 'null' &&
    request.headers.get('sec-fetch-site') === 'same-origin'
  )
    return;
  throw createAppError('AUTHORIZATION');
}

/**
 * Same-origin gate for safe, side-effect-free reads. It refuses only POSITIVE
 * cross-site evidence: fetch metadata other than same-origin/none (direct
 * navigation), or an Origin that differs. A missing Origin must pass because
 * browsers omit it on same-origin GETs. A request carrying neither header is
 * therefore allowed — non-browser clients, but also a legacy browser's
 * cross-site no-cors GET, whose response stays unreadable without CORS.
 * Do not reuse this to guard state changes or sensitive reads; those need a
 * fail-closed check such as requireSameOrigin or an authenticated principal.
 */
export function requireSameOriginRead(request: Request, origin: string) {
  const site = request.headers.get('sec-fetch-site');
  const claimed = request.headers.get('origin');
  if (
    (site !== null && site !== 'same-origin' && site !== 'none') ||
    (claimed !== null && claimed !== new URL(origin).origin)
  )
    throw createAppError('AUTHORIZATION');
}

async function readChunks(
  request: Request,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
) {
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      request.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) {
        await reader.cancel();
        throw createAppError('PAYLOAD_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return { chunks, length };
}

function combineChunks(chunks: readonly Uint8Array[], length: number) {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Bound the stream itself; Content-Length is untrusted and may be absent. */
export async function readJson(
  request: Request,
  maxBytes = 4096,
): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw createAppError('VALIDATION');
  const reader = request.body?.getReader();
  if (!reader) throw createAppError('VALIDATION');
  const { chunks, length } = await readChunks(request, reader, maxBytes);
  const bytes = combineChunks(chunks, length);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw createAppError('VALIDATION');
  }
}
