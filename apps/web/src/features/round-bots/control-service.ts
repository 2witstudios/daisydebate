import type { WorkerTimers } from './worker-timers';
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
  readonly failed: () => void;
}) {
  const owned = new Map<string, Owned<C>>();
  let stopped = false,
    discovering: Promise<void> | null = null,
    pulsing: Promise<void> | null = null;
  const valid = async (entry: Owned<C>) => {
    try {
      await input.store.verifyRoundBotWorker(
        entry.claim.scope,
        entry.claim.token,
      );
      return true;
    } catch {
      return false;
    }
  };
  const pulse = (entry: Owned<C>): Promise<void> => {
    if (entry.pending) return entry.pending;
    entry.pending = (async () => {
      try {
        await entry.control.pulse();
      } catch {
        if (!(await valid(entry))) {
          owned.delete(entry.claim.scope.roundParticipantId);
          await entry.control.stop?.();
        }
        input.failed();
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
      await old.control.stop?.();
      await input.store.revokeRoundBotWorker(old.claim.scope, old.claim.token);
      owned.delete(target.roundParticipantId);
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
      } catch {
        input.failed();
      } finally {
        discovering = null;
      }
    })();
    return discovering;
  };
  const heartbeat = (): Promise<void> => {
    if (stopped || pulsing) return pulsing ?? Promise.resolve();
    pulsing = Promise.all([...owned.values()].map(pulse)).then(() => {
      pulsing = null;
    });
    return pulsing;
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
      await Promise.allSettled([discovering, pulsing]);
      await Promise.allSettled(
        [...owned.values()].map(async (entry) => {
          await entry.pending;
          await entry.control.stop?.();
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
