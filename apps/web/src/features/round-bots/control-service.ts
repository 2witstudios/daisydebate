import type { Waits } from '@daisy/clock';
import { createAppError, isAppError, isRefusal } from '@daisy/errors';
import {
  holdLease,
  pollWork,
  repeatEvery,
  type Lease,
  type LeaseLoss,
  type LoopPass,
  type WorkWake,
} from '@daisy/worker';
import { LIVE_IDLE_MAX_MS } from '../../lib/worker-idle';
type Target = {
  readonly roundId: string;
  readonly roundParticipantId: string;
  readonly segmentId: string;
};
type Claim = { readonly scope: Target; readonly token: string };
/** How soon a renewal that failed without a refusal is tried again, at most. */
const RENEW_RETRY_MS = 1000;
type Control = {
  /** Attendance receipts, and a nudge to the seat's speaker. */
  readonly pulse: () => Promise<unknown>;
  /** Ends speaking work before its lease is revoked or abandoned. */
  readonly stop?: () => Promise<void>;
};
type Owned<C> = {
  readonly claim: C;
  readonly control: Control;
  /** The claim's worker lease, renewed on its own cadence until the seat ends. */
  readonly lease: Lease<void>;
  pending: Promise<void> | null;
  /** Set once the seat starts ending; it stays owned until the ending (or its handoff) settles. */
  ending: Promise<void> | null;
  /** Its lease or its pulse found the lease already gone: there is nothing to revoke. */
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
    /**
     * Extends the claim's lease; it refuses (CONFLICT or AUTHORIZATION) once
     * the lease has expired, been rotated or its Round has ended.
     */
    readonly renewRoundBotWorker: (
      scope: C['scope'],
      token: string,
    ) => Promise<unknown>;
  };
  readonly control: (claim: C) => Control;
  readonly limits: {
    readonly maxControllers: number;
    readonly scanBatch: number;
    readonly scanMs: number;
    /** How often each owned seat checks in its attendance receipts. */
    readonly checkInMs: number;
    /** How often each owned seat's lease is renewed. */
    readonly renewMs: number;
    /** How long a lease holds after the start of its last renewal that held. */
    readonly leaseMs: number;
  };
  readonly waits: Waits;
  /** A Round changed; a bot's turn may be due (ADR 0154). */
  readonly wake?: WorkWake | undefined;
  /**
   * Settles when a seat's ending has run too long, so a stop that never
   * answers cannot keep its seat dark (ISSUE-789); `signal` aborts once the
   * ending is done, so its timer is cleared.
   */
  readonly overdue: (signal: AbortSignal) => Promise<void>;
  /**
   * `stage` names the work that failed: pulse, renew, stop, revoke, claim
   * or discover. It must never throw (the worker sink guards itself), so no
   * promise here rejects because reporting failed (ISSUE-789).
   */
  readonly failed: (error: unknown, stage: string) => void;
}) {
  const failed = input.failed;
  const owned = new Map<string, Owned<C>>();
  let stopped = false;
  // Read live: stop() can run during any await, which narrowing cannot see.
  const isStopped = () => stopped;
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
    Promise.resolve()
      .then(() => input.store.revokeRoundBotWorker(claim.scope, claim.token))
      .then(
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
   * Ends a seat once, apart from the check-ins and discovery: its lease
   * renews no more, its speaking work stops at once (a hung receipt pulse
   * never keeps a speaker alive), and its pulse in flight settles, within
   * `overdue`; then its lease is revoked when `revoke` is set. The seat stays in `owned` until then (or,
   * when it is handing off, until the rotation's chained claim settles and
   * releases it), so it still counts against `maxControllers` and no
   * replacement is claimed beside a speaker still stopping. A stop that fails
   * or overruns is reported and the seat is released anyway (ISSUE-789).
   */
  const end = (entry: Owned<C>, revoke: boolean): Promise<void> => {
    if (entry.ending) return entry.ending;
    const ending = (async () => {
      // An ending seat renews no more: the ending deadline sits inside the
      // lease, so a stop that hangs still lets the lease lapse by itself.
      const leaseStopped = entry.lease.stop();
      let silenced = false;
      // Read live: the stopping task sets it while the race below is awaited.
      const isSilenced = () => silenced;
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
        Promise.resolve()
          .then(() => input.overdue(deadline.signal))
          .then(
            () => 'late' as const,
            // A deadline that cannot be kept ends the seat as an overrun would,
            // but it reports its own error: nothing overran, so a stop failure
            // that comes later is still reported.
            (error: unknown) => {
              failed(error, 'stop');
              return 'unkept' as const;
            },
          ),
      ]);
      deadline.abort();
      if (outcome === 'late') {
        // Names the part still running: the speaker's stop, or the receipt pulse.
        const stage = isSilenced() ? 'pulse' : 'stop';
        entry.overran = stage;
        failed(
          createAppError('INFRASTRUCTURE', `Seat ${stage} overran its ending`),
          stage,
        );
      }
      await leaseStopped;
      if (revoke && !entry.lost) await revokeClaim(entry.claim);
    })()
      // Defence only: every step above guards itself while `failed` keeps its
      // never-throws contract, so nothing reaches this; an ending never rejects.
      .catch((error: unknown) => failed(error, 'stop'))
      .finally(() => {
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
          void end(entry, false);
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
  /**
   * Keeps a fresh claim's lease alive from when its claim started. A refused
   * renewal is a loss (another controller took the seat, or the lease ended
   * with its Round or by expiry); any other failure is a blip, reported and
   * retried until the lease's own term has passed.
   */
  const holdClaim = (claim: C, claimedAtMs: number) =>
    holdLease<void>({
      waits: input.waits,
      facts: undefined,
      claimedAtMs,
      renewEveryMs: input.limits.renewMs,
      retryMs: Math.min(RENEW_RETRY_MS, input.limits.renewMs),
      horizonMs: input.limits.leaseMs,
      renew: async () => {
        await input.store.renewRoundBotWorker(claim.scope, claim.token);
        return { kind: 'held', facts: undefined };
      },
      lossOf: (error): LeaseLoss | null =>
        isAppError(error) && error.code === 'AUTHORIZATION'
          ? 'taken'
          : isRefusal(error)
            ? 'released'
            : null,
      failed: (error) => failed(error, 'renew'),
    });
  /** A lease that ends by itself ends its seat: there is nothing left to revoke. */
  const watchLease = (entry: Owned<C>) => {
    void entry.lease.ended.then((how) => {
      if (how === 'stopped') return;
      entry.lost = true;
      void end(entry, false);
    });
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
      .then(() => claimSeat(target))
      .catch(claimFailed)
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
      isStopped() ||
      seatsHeld() + (owned.has(seat) ? 0 : 1) > input.limits.maxControllers
    )
      return;
    claiming.add(seat);
    let entry: Owned<C>;
    try {
      const claimedAtMs = input.waits.nowMs();
      const claim = await input.store.claimRoundBotWorker(target);
      if (isStopped()) {
        await revokeClaim(claim);
        return;
      }
      let lease: Lease<void> | null = null;
      let control: Control;
      try {
        lease = holdClaim(claim, claimedAtMs);
        control = input.control(claim);
      } catch (error) {
        // A seat that cannot start never holds its lease for a full term.
        await lease?.stop();
        await revokeClaim(claim);
        throw error;
      }
      entry = {
        claim,
        control,
        lease,
        pending: null,
        ending: null,
        lost: false,
        overran: null,
        handingOff: false,
      };
      watchLease(entry);
      owned.set(seat, entry);
    } finally {
      claiming.delete(seat);
    }
    // Not awaited: neither discovery nor shutdown waits on a seat's receipts.
    void pulse(entry);
  };
  /** One discovery pass; it worked while any seat is owned or found. */
  const discover = async (): Promise<LoopPass> => {
    if (isStopped()) return 'idle';
    // A failed scan throws to the loop, which reports it and backs off even
    // while seats are owned.
    const targets = await input.store.scanRoundBotWorkers(
      input.limits.scanBatch,
    );
    for (const target of targets) {
      if (isStopped()) break;
      await claimTarget(target).catch(claimFailed);
    }
    return owned.size > 0 || targets.length > 0 ? 'worked' : 'idle';
  };
  /**
   * Pulses each live seat with no pulse in flight, on its own and without
   * waiting for it: a seat whose pulse fails or hangs never holds another
   * seat's check-ins or the cadence, and a hung one is not pulsed again on
   * every tick (ISSUE-789).
   */
  const checkIns = repeatEvery({
    waits: input.waits,
    everyMs: input.limits.checkInMs,
    run: async () => {
      if (isStopped()) return;
      for (const entry of owned.values())
        if (!entry.pending && !entry.ending) void pulse(entry);
    },
    failed: (error) => failed(error, 'pulse'),
  });
  const discovery = pollWork({
    waits: input.waits,
    backoff: { busyMs: input.limits.scanMs, idleMaxMs: LIVE_IDLE_MAX_MS },
    pass: discover,
    failed: (error) => failed(error, 'discover'),
    wake: input.wake,
  });
  return {
    started: discovery.started,
    async stop() {
      stopped = true;
      const checking = checkIns.stop();
      const discovering = discovery.stop();
      // Speakers end at once; a claim still in flight revokes itself.
      for (const entry of [...owned.values()]) void end(entry, true);
      await Promise.allSettled([checking, discovering, ...endings]);
    },
  };
}
