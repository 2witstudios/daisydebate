import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { z } from 'zod';
import type { botActivityRelaySchema } from '@daisy/protocol/bot-activity';
import type { createMediaWorkerAuthentication } from './worker-auth';
import {
  activityReply,
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
type ActivityFrame = z.infer<typeof botActivityRelaySchema>['frames'][number];
type Dependencies = {
  readonly scope: Scope;
  readonly url: string;
  readonly authentication: ReturnType<typeof createMediaWorkerAuthentication>;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly nowMs: () => number;
  readonly deadlineSignal: () => AbortSignal;
  /**
   * Pauses before each retry of a 503, the server's refusal before any work
   * (such as transcript transaction capacity). Every capture operation is
   * idempotent under its lease, epoch and dedupe identity, so a retry is safe.
   */
  readonly unavailableRetryMs?: readonly number[];
};
const unavailable = () =>
  createAppError('INFRASTRUCTURE', 'Media control is unavailable');
const cancelled = () =>
  createAppError('CONFLICT', 'Media control was cancelled');
const aborted = (signal: AbortSignal, caller?: AbortSignal) => {
  if (caller?.aborted) throw cancelled();
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
/** 503 refusals the call may retry; every other failure is final. */
const refusedForNow = new WeakSet<object>();
function requireSuccess(response: Response) {
  if (response.ok) return;
  if (response.status === 503) {
    const refusal = unavailable();
    refusedForNow.add(refusal);
    throw refusal;
  }
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
/** An abortable pause; a cancelled caller is refused as cancellation. */
async function pause(ms: number, caller?: AbortSignal) {
  if (ms > 0)
    await new Promise<void>((done) => {
      const timer = setTimeout(done, ms);
      caller?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          done();
        },
        { once: true },
      );
    });
  if (caller?.aborted) throw cancelled();
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
  const retries = input.unavailableRetryMs ?? [50, 200, 800];
  const call = async <T>(
    operation: string,
    payload: object,
    schema: z.ZodType<T>,
    caller?: AbortSignal,
  ) => {
    for (const pauseMs of retries)
      try {
        return await attempt(operation, payload, schema, caller);
      } catch (error) {
        if (!refusedForNow.has(error as object)) throw error;
        await pause(pauseMs, caller);
      }
    return attempt(operation, payload, schema, caller);
  };
  const attempt = async <T>(
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
    /** Expendable heuristic relay; the server attaches the receipt and owns admission. */
    activity: async (
      batch: {
        readonly epoch: number;
        readonly roundParticipantId: string;
        readonly segmentId: string;
        readonly frames: readonly ActivityFrame[];
      },
      signal?: AbortSignal,
    ) => {
      await call('activity', { ...batch, version: 1 }, activityReply, signal);
    },
  };
}
