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
   * Pauses before each retry of a 503, the server's temporary refusal (such as
   * transcript transaction capacity, refused at once). Every capture operation
   * is idempotent under its lease, epoch and dedupe identity, so a retry is
   * safe; all attempts share the call's one deadline.
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
/** Seals refused only because the capture timeline has not closed yet. */
const openTimeline = new WeakSet<object>();
/** Requests refused because the capture session or admission is closed. */
const captureClosed = new WeakSet<object>();
/** Whether the server closed the capture for good: the session ends (ISSUE-494). */
export const isCaptureClosedRefusal = (error: unknown) =>
  typeof error === 'object' && error !== null && captureClosed.has(error);
/**
 * A 4xx is a refusal for certain, except a 408 (the outcome is unknown, as in
 * the media service, ISSUE-464) and a 429 (refused for now) (VIDEO-4.1-r4).
 */
const definiteStatus = (status: number) =>
  status >= 400 && status < 500 && status !== 408 && status !== 429;
/** Requests the server definitely refused (see definiteStatus). */
const definite = new WeakSet<object>();
/**
 * Whether the server definitely refused the request. A 408, a 429, a 503 that
 * outlasted its retries, an elapsed deadline or a network failure leaves the
 * outcome uncertain.
 */
export const isDefiniteRefusal = (error: unknown) =>
  typeof error === 'object' && error !== null && definite.has(error);
/** Whether a seal may be resent: its timeline was still open (VIDEO-4.1-r1). */
export const isOpenTimelineRefusal = (error: unknown) =>
  typeof error === 'object' && error !== null && openTimeline.has(error);
/** Throws the refusal; a 409's named refusal is read, never anything else. */
async function refuse(
  response: Response,
  signal: AbortSignal,
  caller?: AbortSignal,
): Promise<never> {
  let named: unknown;
  if (response.status === 409)
    named = await readReply(response, signal, caller).then(
      (raw) => (raw as { refusal?: unknown } | null)?.refusal,
      () => undefined,
    );
  else await response.body?.cancel().catch(() => undefined);
  const error = refusalFor(response.status);
  if (definiteStatus(response.status)) definite.add(error);
  if (named === 'timeline-open') openTimeline.add(error);
  if (named === 'capture-closed') captureClosed.add(error);
  throw error;
}
function refusalFor(status: number) {
  if (status === 503) {
    const refusal = unavailable();
    refusedForNow.add(refusal);
    return refusal;
  }
  const codes = {
    400: 'VALIDATION',
    401: 'AUTHENTICATION',
    403: 'AUTHORIZATION',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
  } as const;
  return createAppError(
    codes[status as keyof typeof codes] ?? 'INFRASTRUCTURE',
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
/**
 * A pause the call's own deadline or caller can cut short; either then
 * refuses as it would before a request.
 */
async function pause(ms: number, signal: AbortSignal, caller?: AbortSignal) {
  if (ms > 0 && !signal.aborted)
    await new Promise<void>((done) => {
      const timer = setTimeout(done, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          done();
        },
        { once: true },
      );
    });
  aborted(signal, caller);
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
    // One deadline per call, retries included, so a call never outlasts the
    // budgets derived from it (lease renewal, STT lag) (VIDEO-4.1-r2).
    const signal = caller
      ? AbortSignal.any([caller, input.deadlineSignal()])
      : input.deadlineSignal();
    for (const pauseMs of retries)
      try {
        return await attempt(operation, payload, schema, signal, caller);
      } catch (error) {
        if (!refusedForNow.has(error as object)) throw error;
        await pause(pauseMs, signal, caller);
      }
    return attempt(operation, payload, schema, signal, caller);
  };
  const attempt = async <T>(
    operation: string,
    payload: object,
    schema: z.ZodType<T>,
    signal: AbortSignal,
    caller?: AbortSignal,
  ) => {
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
    if (!response.ok) await refuse(response, signal, caller);
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
      batch: Stream & { readonly frames: readonly ActivityFrame[] },
      signal?: AbortSignal,
    ) => {
      await call('activity', { ...batch, version: 1 }, activityReply, signal);
    },
    /** Capture hears a bot seat's track (ISSUE-514-r2); the server owns admission. */
    heard: async (
      track: Stream & { readonly trackId: string },
      signal?: AbortSignal,
    ) => {
      await call('heard', { ...track, version: 1 }, activityReply, signal);
    },
  };
}
