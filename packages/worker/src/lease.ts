import type { Waits } from '@daisy/clock';
import { report, type FailureSink } from './failure';

/**
 * Why a lease ended without being stopped: another holder `taken` it, the
 * store `released` it (the work completed or was withdrawn), or it
 * `expired` because no renewal succeeded within the horizon.
 */
export type LeaseLoss = 'taken' | 'released' | 'expired';
export type LeaseEnd = LeaseLoss | 'stopped';

/**
 * One renewal's answer. A held lease may carry the store's current facts
 * (a row whose fields drive the work); `void` when it carries none.
 */
export type LeaseRenewal<Facts> =
  | { readonly kind: 'held'; readonly facts: Facts }
  | { readonly kind: 'lost'; readonly reason: LeaseLoss };

/** The refusal a write meets once its lease has ended. */
export class LeaseEnded extends Error {
  constructor(readonly end: LeaseEnd) {
    super(`The lease ended: ${end}`);
    this.name = 'LeaseEnded';
  }
}

export type Lease<Facts> = {
  /** Aborts, with a `LeaseEnded` reason, the moment the lease ends. */
  readonly signal: AbortSignal;
  /** Resolves with how the lease ended. */
  readonly ended: Promise<LeaseEnd>;
  /** Whether the lease holds now, judged at the call, past the horizon included. */
  readonly holds: () => boolean;
  /** The facts of the last renewal that held, or the claim's. */
  readonly facts: () => Facts;
  /**
   * Runs `write` only while the lease holds, judged at the moment of the
   * call, past the horizon included; otherwise rejects with `LeaseEnded`
   * and never calls it. Every public write of leased work goes through here.
   */
  readonly guard: <T>(write: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  /**
   * Ends the lease, aborting a renewal in flight, and resolves once the
   * renewing has stopped. With `release`, a lease still held is handed back
   * to the store; a store whose lease must never be cleared unfenced omits
   * `release` and is never asked.
   */
  readonly stop: (options?: { readonly release?: boolean }) => Promise<void>;
};

const positive = (value: number) => Number.isSafeInteger(value) && value >= 1;

/**
 * An exclusive lease, kept alive in the background from the moment it was
 * claimed. The fence (owner and epoch, a token, a signed epoch) is the
 * store's: `renew` closes over it, so this never invents authority.
 *
 * A renewal blip is not a loss: a renewal that throws is reported and
 * retried every `retryMs`, and the lease holds until `horizonMs` after the
 * start of the last renewal that held (the claim's start at first), measured
 * on the monotonic clock. Past that it has `expired`, even while a renewal
 * is still in flight. A store that refuses by throwing maps its refusal to a
 * loss through `lossOf`, so a CONFLICT that means the work was completed is
 * `released`, not a blip.
 */
export function holdLease<Facts>(input: {
  readonly waits: Waits;
  /** The claim's facts. */
  readonly facts: Facts;
  /** When the claim that granted the lease started; defaults to now. */
  readonly claimedAtMs?: number;
  readonly renewEveryMs: number;
  readonly retryMs: number;
  /** How long the lease holds after the start of the last renewal that held. */
  readonly horizonMs: number;
  readonly renew: (signal: AbortSignal) => Promise<LeaseRenewal<Facts>>;
  /** A thrown refusal that is a loss; any other throw is a blip. */
  readonly lossOf?: (error: unknown) => LeaseLoss | null;
  readonly failed: FailureSink;
  readonly release?: () => Promise<void>;
}): Lease<Facts> {
  if (
    !positive(input.renewEveryMs) ||
    !positive(input.retryMs) ||
    !positive(input.horizonMs) ||
    input.horizonMs <= input.renewEveryMs
  )
    throw new Error('Invalid lease cadence');
  const { waits } = input;
  const ending = new AbortController();
  let end: LeaseEnd | null = null;
  let facts = input.facts;
  let heldFromMs = input.claimedAtMs ?? waits.nowMs();
  let markEnded: (end: LeaseEnd) => void = () => {};
  const ended = new Promise<LeaseEnd>((resolve) => {
    markEnded = resolve;
  });
  const finish = (reason: LeaseEnd) => {
    if (end !== null) return;
    end = reason;
    ending.abort(new LeaseEnded(reason));
    markEnded(reason);
  };
  const expiresAtMs = () => heldFromMs + input.horizonMs;
  /** Ends an expired lease; true while it still holds. */
  const holds = () => {
    if (end === null && waits.nowMs() >= expiresAtMs()) finish('expired');
    return end === null;
  };

  /** A classifier that throws classifies nothing: the failure is a reported blip. */
  const lossOf = (error: unknown): LeaseLoss | null => {
    try {
      return input.lossOf?.(error) ?? null;
    } catch (thrown) {
      report(input.failed, thrown);
      return null;
    }
  };
  /** One renewal, cut off at the horizon. */
  const renewOnce = async (): Promise<'held' | 'blip' | 'ended'> => {
    const startedAt = waits.nowMs();
    const attempt = new AbortController();
    const signal = AbortSignal.any([ending.signal, attempt.signal]);
    const horizon = waits
      .waitUntilMs(expiresAtMs(), signal)
      .then(() => 'horizon' as const);
    // A renewal that throws before it returns a promise is a failed renewal too.
    const answer = Promise.try(() => input.renew(signal)).then(
      (renewal) => ({ renewal }) as const,
      (error: unknown) => ({ error }) as const,
    );
    const raced = await Promise.race([answer, horizon]);
    // A wait that wakes early is no expiry: only the clock says the horizon passed.
    const first =
      raced === 'horizon' && end === null && waits.nowMs() < expiresAtMs()
        ? await answer
        : raced;
    attempt.abort();
    if (end !== null) return 'ended';
    if (first === 'horizon') {
      finish('expired');
      return 'ended';
    }
    if ('error' in first) {
      const loss = lossOf(first.error);
      if (loss !== null) {
        finish(loss);
        return 'ended';
      }
      report(input.failed, first.error);
      return holds() ? 'blip' : 'ended';
    }
    if (first.renewal.kind === 'lost') {
      finish(first.renewal.reason);
      return 'ended';
    }
    facts = first.renewal.facts;
    heldFromMs = startedAt;
    return 'held';
  };
  const renewing = (async () => {
    let delayMs = input.renewEveryMs;
    while (holds()) {
      // Never sleeps past the horizon, so an expiry ends the lease on time.
      await waits.sleep(
        Math.min(delayMs, expiresAtMs() - waits.nowMs()),
        ending.signal,
      );
      if (!holds()) return;
      const outcome = await renewOnce();
      if (outcome === 'ended') return;
      delayMs = outcome === 'held' ? input.renewEveryMs : input.retryMs;
    }
  })();

  return {
    signal: ending.signal,
    ended,
    holds,
    facts: () => facts,
    guard: async (write) => {
      if (!holds()) throw new LeaseEnded(end ?? 'expired');
      return write(ending.signal);
    },
    async stop(options) {
      const heldAtStop = holds();
      finish('stopped');
      await renewing;
      if (heldAtStop && options?.release && input.release)
        await input.release().catch((error: unknown) => {
          report(input.failed, error);
        });
    },
  };
}
