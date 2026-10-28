import { createAppError, isAppError } from '@daisy/errors';
import type { WorkerTimers } from '../../lib/worker-timers';
type Target = {
  readonly roundId: string;
  readonly roundParticipantId: string;
  readonly segmentId: string;
};
type Claim = { readonly scope: Target; readonly token: string };
type Control = {
  readonly pulse: () => Promise<unknown>;
  /** Ends speaking work before its lease is revoked or abandoned. */
  readonly stop?: () => Promise<void>;
};
type Owned<C> = {
  readonly claim: C;
  readonly control: Control;
  pending: Promise<void> | null;
  /** Set once the seat starts ending; it stays owned until the ending settles. */
  ending: Promise<void> | null;
  /** Its pulse found the lease already gone: there is nothing to revoke. */
  lost: boolean;
};
/** Idle worker control owns receipts even when generation/publication cannot run. */
export function startBotControlService<C extends Claim>(input: {
  readonly store: {
    readonly scanRoundBotWorkers: (limit: number) => Promise<readonly Target[]>;
    readonly claimRoundBotWorker: (target: Target) => Promise<C>;
    readonly revokeRoundBotWorker: (
      scope: C['scope'],
      token: string,
    ) => Promise<unknown>;
    readonly verifyRoundBotWorker: (
      scope: C['scope'],
      token: string,
    ) => Promise<unknown>;
  };
  readonly control: (claim: C) => Control;
  readonly limits: {
    readonly maxControllers: number;
    readonly scanBatch: number;
    readonly scanMs: number;
    readonly renewMs: number;
  };
  readonly timers: WorkerTimers;
  /**
   * Settles when a seat's ending has run too long, so a stop that never
   * answers cannot keep its seat dark (ISSUE-789); `signal` aborts once the
   * ending is done, so its timer is cleared.
   */
  readonly overdue: (signal: AbortSignal) => Promise<void>;
  /** `stage` names the work that failed: pulse, stop, revoke or discover. */
  readonly failed: (error: unknown, stage: string) => void;
}) {
  const owned = new Map<string, Owned<C>>();
  let stopped = false,
    discovering: Promise<void> | null = null;
  /** Seat endings still running; shutdown waits for every one. */
  const endings = new Set<Promise<void>>();
  /** Seats with a claim in flight, so a chained and a scanned claim never race. */
  const claiming = new Set<string>();
  /** A definite refusal of the lease: the Round ended or the claim moved on. */
  const refusedAuthority = (error: unknown) =>
    isAppError(error) &&
    (error.code === 'AUTHORIZATION' || error.code === 'CONFLICT');
  /**
   * Lost only on a definite refusal of the lease. A check that failed (pool
   * capacity, a reset) proves nothing, so the seat stays owned; dropping it
   * would let the lease lapse and the seat speak again (ISSUE-456).
   */
  const authorityLost = async (entry: Owned<C>) => {
    try {
      await input.store.verifyRoundBotWorker(
        entry.claim.scope,
        entry.claim.token,
      );
      return false;
    } catch (error) {
      return refusedAuthority(error);
    }
  };
  /** Drops a seat only while it is still this entry, never a claim that replaced it. */
  const release = (entry: Owned<C>) => {
    const seat = entry.claim.scope.roundParticipantId;
    if (owned.get(seat) === entry) owned.delete(seat);
  };
  /**
   * Ends a seat once, apart from the heartbeat and discovery: its speaking
   * work stops at once (a hung receipt pulse never keeps a speaker alive),
   * and its pulse in flight settles, within `overdue`; then its lease is
   * revoked when `revoke` is set. The seat stays in `owned` until then, so it
   * still counts against `maxControllers` and no replacement is claimed
   * beside a speaker still stopping. A stop that fails or overruns is
   * reported and the seat is released anyway (ISSUE-789).
   */
  const end = (entry: Owned<C>, revoke: boolean): Promise<void> => {
    if (entry.ending) return entry.ending;
    const ending = (async () => {
      let spoken = false,
        overran = false;
      const stopping = (async () => {
        try {
          await entry.control.stop?.();
        } catch (error) {
          // A stop that fails after its overrun was reported is not reported twice.
          if (!overran) input.failed(error, 'stop');
        }
        spoken = true;
        await entry.pending;
        return 'ended' as const;
      })();
      const deadline = new AbortController();
      const outcome = await Promise.race([
        stopping,
        input.overdue(deadline.signal).then(() => 'late' as const),
      ]);
      deadline.abort();
      if (outcome === 'late') {
        overran = true;
        // Names the part still running: the speaker's stop, or the receipt pulse.
        const stage = spoken ? 'pulse' : 'stop';
        input.failed(
          createAppError('INFRASTRUCTURE', `Seat ${stage} overran its ending`),
          stage,
        );
      }
      if (revoke && !entry.lost)
        await input.store
          .revokeRoundBotWorker(entry.claim.scope, entry.claim.token)
          // A refused revoke is a lease already gone; any other lapses alone.
          .catch((error: unknown) => {
            if (!refusedAuthority(error)) input.failed(error, 'revoke');
          });
    })().finally(() => {
      release(entry);
      endings.delete(ending);
    });
    endings.add(ending);
    entry.ending = ending;
    return ending;
  };
  const pulse = (entry: Owned<C>): Promise<void> => {
    if (entry.pending) return entry.pending;
    entry.pending = (async () => {
      try {
        await entry.control.pulse();
      } catch (error) {
        if (await authorityLost(entry)) {
          // Authority ended (Round completed or claim rotated): a release, not a fault.
          entry.lost = true;
          void end(entry, false);
          return;
        }
        input.failed(error, 'pulse');
      } finally {
        entry.pending = null;
      }
    })();
    return entry.pending;
  };
  const claimTarget = async (target: Target): Promise<void> => {
    const seat = target.roundParticipantId;
    const old = owned.get(seat);
    if (
      claiming.has(seat) ||
      old?.ending ||
      old?.claim.scope.segmentId === target.segmentId
    )
      return;
    if (old) {
      // The incoming segment is claimed as soon as the ending frees the seat;
      // shutdown waits for that claim like any ending.
      const handoff: Promise<void> = end(old, true)
        .then(() => claimTarget(target))
        .catch(() => undefined)
        .finally(() => endings.delete(handoff));
      endings.add(handoff);
      return;
    }
    if (stopped || owned.size >= input.limits.maxControllers) return;
    claiming.add(seat);
    let entry: Owned<C>;
    try {
      const claim = await input.store.claimRoundBotWorker(target);
      if (stopped) {
        await input.store.revokeRoundBotWorker(claim.scope, claim.token);
        return;
      }
      entry = {
        claim,
        control: input.control(claim),
        pending: null,
        ending: null,
        lost: false,
      };
      owned.set(seat, entry);
    } finally {
      claiming.delete(seat);
    }
    await pulse(entry);
  };
  const discover = (): Promise<void> => {
    if (stopped || discovering) return discovering ?? Promise.resolve();
    discovering = (async () => {
      try {
        const targets = await input.store.scanRoundBotWorkers(
          input.limits.scanBatch,
        );
        for (const target of targets) {
          if (stopped) break;
          try {
            await claimTarget(target);
          } catch {
            /* Another controller may claim or rotate this target first. */
          }
        }
      } catch (error) {
        input.failed(error, 'discover');
      } finally {
        discovering = null;
      }
    })();
    return discovering;
  };
  /**
   * Pulses each live seat with no pulse in flight, on its own: a seat whose
   * pulse fails or hangs never holds another seat's renewal, and a hung one
   * is not awaited again on every tick (ISSUE-789). It never rejects.
   */
  const heartbeat = async (): Promise<void> => {
    if (stopped) return;
    await Promise.allSettled(
      [...owned.values()]
        .filter((entry) => !entry.pending && !entry.ending)
        .map(pulse),
    );
  };
  const scanTimer = input.timers.setInterval(discover, input.limits.scanMs);
  const pulseTimer = input.timers.setInterval(heartbeat, input.limits.renewMs);
  const started = discover();
  return {
    started,
    async stop() {
      stopped = true;
      input.timers.clearInterval(scanTimer);
      input.timers.clearInterval(pulseTimer);
      // Speakers end at once; a claim still in flight revokes itself.
      for (const entry of [...owned.values()]) void end(entry, true);
      await Promise.allSettled([discovering, ...endings]);
      await Promise.allSettled([...endings]);
    },
  };
}
