import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { TransportObservation } from './transport-observation';
import type { sample } from './sample';
import { settle } from './settle';
type Sample = Extract<ReturnType<typeof sample>, { kind: 'sample' }>;
type Ready = {
  readonly kind: 'idle';
  readonly lastStartedMs: number | null;
  readonly originalIdentity: string | null;
  readonly previous: Sample | null;
};
type Mode =
  | Ready
  | { readonly kind: 'reading'; readonly controller: AbortController }
  | { readonly kind: 'closed' | 'replaced' | 'unbound' };
const unknown = (
  reason: Extract<TransportObservation, { kind: 'unknown' }>['reason'],
): TransportObservation => ({ kind: 'unknown', reason });
/** One binding's bounded SDK reader. The resource must honor its signal/deadline; production uses Track.getStats. */
export function create(input: {
  readonly binding: {
    readonly incarnation: string;
    readonly trackId: string;
    readonly generation: number;
  };
  readonly nowMs: () => number;
  readonly readStats: (options: {
    signal: AbortSignal;
    timeoutMs: number;
  }) => Promise<unknown>;
}) {
  if (
    !idSchema.safeParse(input.binding.incarnation).success ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.binding.trackId) ||
    !Number.isSafeInteger(input.binding.generation) ||
    input.binding.generation < 1
  )
    throw createAppError('VALIDATION', 'Invalid native transport binding');
  const binding = { ...input.binding };
  let mode: Mode = {
    kind: 'idle',
    lastStartedMs: null,
    originalIdentity: null,
    previous: null,
  };
  const current = (): Mode => mode;
  const clock = () => {
    try {
      const value = input.nowMs();
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };
  const ended = () => {
    const kind = current().kind;
    return kind === 'replaced'
      ? unknown('replaced')
      : kind === 'unbound'
        ? unknown('unbound')
        : unknown('closed');
  };
  return {
    async read(signal?: AbortSignal): Promise<TransportObservation> {
      const ready = current();
      if (ready.kind === 'reading') return unknown('busy');
      if (ready.kind !== 'idle') return ended();
      if (signal?.aborted) return unknown('cancelled');
      const startedAtMs = clock();
      if (
        startedAtMs === null ||
        (ready.lastStartedMs !== null && startedAtMs < ready.lastStartedMs)
      )
        return unknown('clock');
      // Poll admission rate, not a capture/preservation/permission latency guarantee.
      if (
        ready.lastStartedMs !== null &&
        startedAtMs - ready.lastStartedMs < 250
      )
        return unknown('throttled');
      const controller = new AbortController(),
        reading: Mode = { kind: 'reading', controller };
      mode = reading;
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      const refuse = (
        reason: Extract<TransportObservation, { kind: 'unknown' }>['reason'],
      ) => {
        mode = {
          kind: 'idle',
          lastStartedMs: startedAtMs,
          originalIdentity: ready.originalIdentity,
          previous: null,
        };
        return unknown(reason);
      };
      try {
        if (signal?.aborted) return refuse('cancelled');
        const reply = await input.readStats({
          signal: controller.signal,
          timeoutMs: 1000,
        });
        if (current() !== reading) return ended();
        if (controller.signal.aborted) return refuse('cancelled');
        const decision = settle(
          { ...ready, startedAtMs, endedAtMs: clock() },
          reply,
        );
        if (current() !== reading) return ended();
        if (decision.kind === 'unknown') return refuse(decision.reason);
        if (decision.kind === 'replaced') {
          mode = { kind: 'replaced' };
          return unknown('replaced');
        }
        const value = decision.sample;
        mode = {
          kind: 'idle',
          lastStartedMs: startedAtMs,
          originalIdentity: ready.originalIdentity ?? value.identity,
          previous: value,
        };
        return {
          kind: 'observed',
          binding: { ...binding },
          startedAtMs,
          endedAtMs: decision.endedAtMs,
          baseline: decision.baseline,
          counters: { ...value.counters },
        };
      } catch (error) {
        if (current() !== reading) return ended();
        const code =
          error instanceof Error &&
          'code' in error &&
          typeof error.code === 'string'
            ? error.code
            : null;
        // A post-dispatch native failure poisons the track binding in the
        // patched SDK: every later read reports REBIND and can never succeed,
        // so this binding is terminal and a caller needs a new subscription.
        if (code === 'TRACK_STATS_REBIND') {
          mode = { kind: 'unbound' };
          return unknown('unbound');
        }
        if (code === 'TRACK_STATS_CLOSED') {
          mode = { kind: 'closed' };
          return unknown('closed');
        }
        return refuse(controller.signal.aborted ? 'cancelled' : 'unavailable');
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
    },
    close() {
      const before = current();
      mode = { kind: 'closed' };
      if (before.kind === 'reading') before.controller.abort();
    },
  };
}
