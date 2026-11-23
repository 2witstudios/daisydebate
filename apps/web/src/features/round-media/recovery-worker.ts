import type { Waits } from '@daisy/clock';
import { pollWork, type LoopPass, type WorkWake } from '@daisy/worker';
import { LIVE_IDLE_MAX_MS } from '../../lib/worker-idle';

/** The busy cadence of media recovery while any media session is live. */
const MEDIA_RECOVERY_MS = 500;

/**
 * Optional media recovery on its own worker loop (ADR 0154), never waiting
 * behind generation or control. A pass waits only for the session list: the
 * recovery it starts runs on, so a slow Round holds only itself and the
 * next pass still starts on time (ISSUE-972). It is busy while any session
 * is live, the probe's aside, and backs off when none is.
 */
export function startRoundMediaRecovery(input: {
  /** Calls `listed` with the live sessions' Rounds before recovering them. */
  readonly recover: (
    listed: (roundIds: readonly string[]) => void,
  ) => Promise<unknown>;
  /** The availability probe's synthetic Round: live forever, never work. */
  readonly probeRoundId?: string | null;
  readonly failed: (error: unknown) => void;
  readonly waits: Waits;
  readonly wake?: WorkWake | undefined;
}) {
  const running = new Set<Promise<void>>();
  /**
   * Resolves once the session list is in: `worked` or `idle` from it. A list
   * that fails rejects, so the loop reports it and backs off as `failed`
   * (and ignores wakes) while a failure after the list is the recovery's own.
   */
  const pass = () =>
    new Promise<LoopPass>((settle, refuse) => {
      let listed = false;
      const tick: Promise<void> = Promise.resolve()
        .then(() =>
          input.recover((roundIds) => {
            listed = true;
            settle(
              roundIds.some((id) => id !== input.probeRoundId)
                ? 'worked'
                : 'idle',
            );
          }),
        )
        .then(
          () => settle('idle'),
          (error: unknown) => {
            if (listed) input.failed(error);
            else refuse(error);
          },
        )
        .finally(() => {
          running.delete(tick);
        });
      running.add(tick);
    });
  const loop = pollWork({
    pass: pass,
    backoff: { busyMs: MEDIA_RECOVERY_MS, idleMaxMs: LIVE_IDLE_MAX_MS },
    waits: input.waits,
    failed: input.failed,
    wake: input.wake,
  });
  return {
    started: loop.started,
    async stop() {
      await loop.stop();
      await Promise.all(running);
    },
  };
}
