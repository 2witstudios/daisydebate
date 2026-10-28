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
   * Ends a seat's speaking work once it is out of `owned`. A stop that fails
   * (a native publication whose room is already gone) is reported, never
   * thrown, so it cannot keep a lease from being released (ISSUE-789).
   */
  const stopSeat = async (entry: Owned<C>) => {
    try {
      await entry.control.stop?.();
    } catch (error) {
      input.failed(error, 'stop');
    }
  };
  const pulse = (entry: Owned<C>): Promise<void> => {
    if (entry.pending) return entry.pending;
    entry.pending = (async () => {
      try {
        await entry.control.pulse();
      } catch (error) {
        if (await authorityLost(entry)) {
          release(entry);
          await stopSeat(entry);
          // Authority ended (Round completed or claim rotated): a release, not a fault.
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
    if (old) {
      await old.pending;
      // Out of `owned` first, so no heartbeat pulses it while it stops.
      release(old);
      await stopSeat(old);
      await input.store.revokeRoundBotWorker(old.claim.scope, old.claim.token);
    }
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
   * Pulses every owned seat on its own: `pulse` already keeps one in flight
   * per seat, so a seat whose pulse or stop fails or hangs never holds
   * another seat's renewal (ISSUE-789). It never rejects.
   */
  const heartbeat = async (): Promise<void> => {
    if (stopped) return;
    await Promise.allSettled([...owned.values()].map(pulse));
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
      await Promise.allSettled(
        [...owned.values()].map(async (entry) => {
          await entry.pending;
          await stopSeat(entry);
          await input.store.revokeRoundBotWorker(
            entry.claim.scope,
            entry.claim.token,
          );
        }),
      );
      owned.clear();
    },
  };
}
