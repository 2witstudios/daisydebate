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
import {
  aborted,
  unavailable,
  definiteStatus,
  refuse,
  readReply,
  isRefusedForNow,
} from './worker-response';
export {
  isCaptureClosedRefusal,
  isDefiniteRefusal,
  isOpenTimelineRefusal,
} from './worker-response';

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
        if (!isRefusedForNow(error)) throw error;
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
    // An observed definite refusal remains authority even if a deadline
    // expired as fetch resolved; do not turn it into retryable cancellation.
    if (!response.ok && definiteStatus(response.status))
      await refuse(response, signal, caller);
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
