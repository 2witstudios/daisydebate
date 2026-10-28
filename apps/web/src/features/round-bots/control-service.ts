import { createAppError, isRefusal } from '@daisy/errors';
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
  /** Set once the seat starts ending; it stays owned until the ending (or its handoff) settles. */
  ending: Promise<void> | null;
  /** Its pulse found the lease already gone: there is nothing to revoke. */
  lost: boolean;
  /** The part of its ending that overran and was reported; that part's late failure is not. */
  overran: 'stop' | 'pulse' | null;
  /** A rotation's chained claim, not the ending, releases this seat. */
  handingOff: boolean;
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
  /**
   * `stage` names the work that failed: pulse, stop, revoke, claim or
   * discover. It must never throw (the worker sink guards itself), so no
   * promise here rejects because reporting failed (ISSUE-789).
   */
  readonly failed: (error: unknown, stage: string) => void;
}) {
  const failed = input.failed;
  const owned = new Map<string, Owned<C>>();
  let stopped = false,
    discovering: Promise<void> | null = null;
  /** Seat endings still running; shutdown waits for every one. */
  const endings = new Set<Promise<void>>();
  /** Seats with a claim in flight, so a chained and a scanned claim never race. */
  const claiming = new Set<string>();
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
      return isRefusal(error);
    }
  };
  /**
   * Revokes a claim; a refusal is a lease already gone, and any other
   * failure is reported while the lease lapses on its own.
   */
  const revokeClaim = (claim: C) =>
    input.store.revokeRoundBotWorker(claim.scope, claim.token).then(
      () => undefined,
      (error: unknown) => {
        if (!isRefusal(error)) failed(error, 'revoke');
      },
    );
  /** Drops a seat only while it is still this entry, never a claim that replaced it. */
  const release = (entry: Owned<C>) => {
    const seat = entry.claim.scope.roundParticipantId;
    if (owned.get(seat) === entry) owned.delete(seat);
  };
  /**
   * Ends a seat once, apart from the heartbeat and discovery: its speaking
   * work stops at once (a hung receipt pulse never keeps a speaker alive),
   * and its pulse in flight settles, within `overdue`; then its lease is
   * revoked when `revoke` is set. The seat stays in `owned` until then (or,
   * when it is handing off, until the rotation's chained claim settles and
   * releases it), so it still counts against `maxControllers` and no
   * replacement is claimed beside a speaker still stopping. A stop that fails
   * or overruns is reported and the seat is released anyway (ISSUE-789).
   */
  const end = (entry: Owned<C>, revoke: boolean): Promise<void> => {
    if (entry.ending) return entry.ending;
    const ending = (async () => {
      let silenced = false;
      const stopping = (async () => {
        try {
          await entry.control.stop?.();
        } catch (error) {
          // A stop that fails after its overrun was reported is not reported twice.
          if (entry.overran !== 'stop') failed(error, 'stop');
        }
        silenced = true;
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
        // Names the part still running: the speaker's stop, or the receipt pulse.
        const stage = silenced ? 'pulse' : 'stop';
        entry.overran = stage;
        failed(
          createAppError('INFRASTRUCTURE', `Seat ${stage} overran its ending`),
          stage,
        );
      }
      if (revoke && !entry.lost) await revokeClaim(entry.claim);
    })().finally(() => {
      if (!entry.handingOff) release(entry);
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
          void end(entry, false).catch((ending: unknown) =>
            failed(ending, 'stop'),
          );
          return;
        }
        // A pulse that outlived its overrun was already reported as it.
        if (entry.overran !== 'pulse') failed(error, 'pulse');
      } finally {
        entry.pending = null;
      }
    })();
    return entry.pending;
  };
  /** Another controller claiming or rotating the seat first is no fault. */
  const claimFailed = (error: unknown) => {
    if (!isRefusal(error)) failed(error, 'claim');
  };
  /** Seats owned or being claimed: the count `maxControllers` bounds. */
  const seatsHeld = () => {
    let held = owned.size;
    for (const seat of claiming) if (!owned.has(seat)) held += 1;
    return held;
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
    if (!old) return claimSeat(target);
    // The outgoing claim stays owned until the incoming one settles, so its
    // slot is never free between them; shutdown waits for the chain.
    old.handingOff = true;
    const chained: Promise<void> = end(old, true)
      .then(
        () => claimSeat(target).catch(claimFailed),
        (error: unknown) => failed(error, 'stop'),
      )
      .finally(() => {
        release(old);
        endings.delete(chained);
      });
    endings.add(chained);
  };
  /** Claims a seat no live claim holds, counting a seat it replaces once. */
  const claimSeat = async (target: Target): Promise<void> => {
    const seat = target.roundParticipantId;
    if (
      stopped ||
      seatsHeld() + (owned.has(seat) ? 0 : 1) > input.limits.maxControllers
    )
      return;
    claiming.add(seat);
    let entry: Owned<C>;
    try {
      const claim = await input.store.claimRoundBotWorker(target);
      if (stopped) {
        await revokeClaim(claim);
        return;
      }
      let control: Control;
      try {
        control = input.control(claim);
      } catch (error) {
        // A seat that cannot start never holds its lease for a full term.
        await revokeClaim(claim);
        throw error;
      }
      entry = {
        claim,
        control,
        pending: null,
        ending: null,
        lost: false,
        overran: null,
        handingOff: false,
      };
      owned.set(seat, entry);
    } finally {
      claiming.delete(seat);
    }
    // Not awaited: neither discovery nor shutdown waits on a seat's receipts.
    void pulse(entry);
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
          await claimTarget(target).catch(claimFailed);
        }
      } catch (error) {
        failed(error, 'discover');
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
    },
  };
}
