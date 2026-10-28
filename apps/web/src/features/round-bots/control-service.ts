import { isAppError } from '@daisy/errors';
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
  /** Set once the seat is released: its stop, and revoke when asked, run once. */
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
  /** `stage` names the work that failed: pulse, stop or discover. */
  readonly failed: (error: unknown, stage: string) => void;
}) {
  const owned = new Map<string, Owned<C>>();
  let stopped = false,
    discovering: Promise<void> | null = null;
  /** Seat endings still running; shutdown waits for every one. */
  const endings = new Set<Promise<void>>();
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
      return (
        isAppError(error) &&
        (error.code === 'AUTHORIZATION' || error.code === 'CONFLICT')
      );
    }
  };
  /** Drops a seat only while it is still this entry, never a claim that replaced it. */
  const release = (entry: Owned<C>) => {
    const seat = entry.claim.scope.roundParticipantId;
    if (owned.get(seat) === entry) owned.delete(seat);
  };
  /**
   * Releases a seat and ends it once: after its pulse in flight, its speaking
   * work stops, then its lease is revoked when `revoke` is set. It runs apart
   * from the heartbeat and discovery, so a stop that fails or never settles
   * (a native publication whose room is already gone) holds no other seat's
   * renewal or claim; a failed stop is reported, never thrown (ISSUE-789).
   */
  const end = (entry: Owned<C>, revoke: boolean): Promise<void> => {
    release(entry);
    if (entry.ending) return entry.ending;
    const ending = (async () => {
      await entry.pending;
      try {
        await entry.control.stop?.();
      } catch (error) {
        input.failed(error, 'stop');
      }
      if (revoke && !entry.lost)
        await input.store
          .revokeRoundBotWorker(entry.claim.scope, entry.claim.token)
          // An unrevoked lease lapses on its own; the next scan claims again.
          .catch(() => undefined);
    })().finally(() => endings.delete(ending));
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
  const claimTarget = async (target: Target) => {
    const old = owned.get(target.roundParticipantId);
    if (old?.claim.scope.segmentId === target.segmentId) return;
    // The outgoing claim ends on its own; the incoming one is claimed once
    // its lease is revoked, on this scan or a later one.
    if (old) void end(old, true);
    if (stopped || owned.size >= input.limits.maxControllers) return;
    const claim = await input.store.claimRoundBotWorker(target);
    if (stopped) {
      await input.store.revokeRoundBotWorker(claim.scope, claim.token);
      return;
    }
    const entry: Owned<C> = {
      claim,
      control: input.control(claim),
      pending: null,
      ending: null,
      lost: false,
    };
    owned.set(target.roundParticipantId, entry);
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
   * Pulses each owned seat with no pulse in flight, on its own: a seat whose
   * pulse fails or hangs never holds another seat's renewal, and a hung one
   * is not awaited again on every tick (ISSUE-789). It never rejects.
   */
  const heartbeat = async (): Promise<void> => {
    if (stopped) return;
    await Promise.allSettled(
      [...owned.values()].filter((entry) => !entry.pending).map(pulse),
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
      await Promise.allSettled([discovering]);
      for (const entry of [...owned.values()]) void end(entry, true);
      await Promise.allSettled([...endings]);
    },
  };
}
