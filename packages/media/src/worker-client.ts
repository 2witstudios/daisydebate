import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { z } from 'zod';
import type { createMediaWorkerAuthentication } from './worker-auth';
import {
  captureStateReply,
  captureMutationReply,
  leaseReply,
  sealReply,
  tokenReply,
} from './worker-replies';

type Scope = {
  readonly roundId: string;
  readonly sessionId: string;
  readonly workerId: string;
};
type Stream = {
  readonly epoch: number;
  readonly segmentId: string;
  readonly roundParticipantId: string;
};
type Dependencies = {
  readonly scope: Scope;
  readonly url: string;
  readonly authentication: ReturnType<typeof createMediaWorkerAuthentication>;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly nowMs: () => number;
  readonly deadlineSignal: () => AbortSignal;
};
const unavailable = () =>
  createAppError('INFRASTRUCTURE', 'Media control is unavailable');
const aborted = (signal: AbortSignal, caller?: AbortSignal) => {
  if (caller?.aborted)
    throw createAppError('CONFLICT', 'Media control was cancelled');
  if (signal.aborted) throw unavailable();
};
function controlOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw unavailable();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw unavailable();
  return url.origin;
}
function requireSuccess(response: Response) {
  if (response.ok) return;
  const codes = {
    400: 'VALIDATION',
    401: 'AUTHENTICATION',
    403: 'AUTHORIZATION',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
  } as const;
  throw createAppError(
    codes[response.status as keyof typeof codes] ?? 'INFRASTRUCTURE',
  );
}
async function readReply(
  response: Response,
  signal: AbortSignal,
  caller?: AbortSignal,
) {
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      aborted(signal, caller);
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 1024 * 1024) throw unavailable();
      chunks.push(value);
    }
    aborted(signal, caller);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    aborted(signal, caller);
    throw unavailable();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
function parsed<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw unavailable();
  return result.data;
}

/** Actual signed HTTP transport. Replies are observations, never local clock or capture authority. */
export function createMediaWorkerClient(input: Dependencies) {
  const origin = controlOrigin(input.url);
  const scope = { ...input.scope };
  if (!Object.values(scope).every((id) => idSchema.safeParse(id).success))
    throw createAppError('VALIDATION');
  const call = async <T>(
    operation: string,
    payload: object,
    schema: z.ZodType<T>,
    caller?: AbortSignal,
  ) => {
    const signal = caller
      ? AbortSignal.any([caller, input.deadlineSignal()])
      : input.deadlineSignal();
    aborted(signal, caller);
    const path = `/api/internal/media/${scope.roundId}/capture/${operation}`;
    const body = JSON.stringify({ ...payload, ...scope });
    const signed = input.authentication.sign({ method: 'POST', path, body });
    const sentAtMs = input.nowMs();
    if (!Number.isFinite(sentAtMs)) throw unavailable();
    let response: Response;
    try {
      response = await input.fetch(`${origin}${path}`, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          'x-daisy-media-timestamp': signed.timestamp,
          'x-daisy-media-signature': signed.signature,
        },
        body,
        signal,
      });
    } catch {
      aborted(signal, caller);
      throw unavailable();
    }
    aborted(signal, caller);
    if (!response.ok) await response.body?.cancel().catch(() => undefined);
    requireSuccess(response);
    const raw = await readReply(response, signal, caller);
    const receivedAtMs = input.nowMs();
    if (!Number.isFinite(receivedAtMs) || receivedAtMs < sentAtMs)
      throw unavailable();
    return { value: parsed(schema, raw), sentAtMs, receivedAtMs };
  };
  return {
    lease: async (leaseMs: number, signal?: AbortSignal) =>
      (await call('lease', { leaseMs }, leaseReply, signal)).value,
    async read(
      request: {
        readonly epoch: number;
        readonly segmentId?: string;
        readonly expectedVersion?: number;
        readonly afterIntervalId?: string;
      },
      signal?: AbortSignal,
    ) {
      const reply = await call('read', request, captureStateReply, signal);
      if (
        reply.value.roundId !== scope.roundId ||
        reply.value.sessionId !== scope.sessionId
      )
        throw unavailable();
      return {
        state: reply.value,
        calibration: {
          sentAtMs: reply.sentAtMs,
          receivedAtMs: reply.receivedAtMs,
          serverNowMs: Date.parse(reply.value.serverNow),
          precisionMs: 1,
        },
      };
    },
    async token(epoch: number, signal?: AbortSignal) {
      const reply = (await call('token', { epoch }, tokenReply, signal)).value;
      if (
        reply.sessionId !== scope.sessionId ||
        !['ws:', 'wss:'].includes(new URL(reply.url).protocol)
      )
        throw unavailable();
      return reply;
    },
    append: async (
      clip: Stream & {
        readonly trackId: string;
        readonly startOffsetMs: number;
        readonly durationMs: number;
        readonly text: string;
        readonly before: string;
        readonly after: string;
      },
      signal?: AbortSignal,
    ) => (await call('append', clip, captureMutationReply, signal)).value,
    observe: async (
      observation: Stream & {
        readonly trackId: string;
        readonly observedFrom: string;
        readonly observedUntil: string;
      },
      signal?: AbortSignal,
    ) =>
      (await call('observe', observation, captureMutationReply, signal)).value,
    seal: async (
      stream: Stream & { readonly expectedChunkCount: number },
      signal?: AbortSignal,
    ) => (await call('seal', stream, sealReply, signal)).value,
  };
}
