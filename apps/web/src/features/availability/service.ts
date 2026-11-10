import { createAppError } from '@daisy/errors';
import type { WorkerTimers } from '../../lib/worker-timers';
import {
  afterRenewal,
  checkLease,
  RENEW_INTERVAL_MS,
  startingLease,
  type LeaseLapse,
  type LeaseRenewal,
} from './lease-health';

type Sampler = {
  readonly elect: () => Promise<boolean>;
  readonly sample: (evidence: {
    readonly publicProbeHealthy: boolean;
  }) => Promise<unknown>;
  readonly close: () => Promise<void>;
};
/** How often the elected sampler rechecks that the probe's resources exist. */
const PROBE_RESOURCE_CHECK_MS = 60 * 60_000;
/** How soon a failed check tries again. */
const PROBE_RESOURCE_RETRY_MS = 60_000;
/** Every peer renews its lease; only the actual elected session probes public ingress. */
export function startAvailabilityService(deps: {
  readonly instanceId: string;
  readonly store: {
    /** Whether the renewal wrote this instance's lease row. */
    readonly renewServiceInstance: (input: {
      readonly instanceId: string;
      readonly role: 'web';
    }) => Promise<boolean>;
    readonly reconcileRoundCheckInAttempts: (limit: number) => Promise<number>;
    readonly availabilitySampler: () => Sampler;
  };
  readonly probe: () => Promise<boolean>;
  /**
   * Whether the configured probe's resources still exist, read at start and
   * then hourly. Never decides health.
   */
  readonly probeResources?: () => Promise<readonly string[]>;
  readonly probeInvalid?: (problem: string) => void;
  /** Monotonic milliseconds. */
  readonly nowMs: () => number;
  readonly timers: WorkerTimers;
  readonly failed: () => void;
  /**
   * This instance's lease has gone unproven by a timely renewal for 10 s,
   * then every 5 minutes while it stays so (DAISY-WEB-9). Never on a stop.
   */
  readonly lapsing: (lapse: LeaseLapse) => void;
}) {
  const { nowMs } = deps;
  let resourcesCheckedAt = Number.NEGATIVE_INFINITY;
  let checkingResources = false;
  /** Beside the cycle, never in it: pool pressure must not stall the sampler. */
  const checkProbeResources = async () => {
    if (
      !deps.probeResources ||
      checkingResources ||
      nowMs() - resourcesCheckedAt < PROBE_RESOURCE_CHECK_MS
    )
      return;
    checkingResources = true;
    try {
      const problems = await deps.probeResources();
      resourcesCheckedAt = nowMs();
      for (const problem of problems) deps.probeInvalid?.(problem);
    } catch {
      // Not every second, into the pressure that caused it.
      resourcesCheckedAt =
        nowMs() - PROBE_RESOURCE_CHECK_MS + PROBE_RESOURCE_RETRY_MS;
      deps.probeInvalid?.('check_failed');
    } finally {
      checkingResources = false;
    }
  };
  const sampler = deps.store.availabilitySampler();
  let stopped = false;
  let running: Promise<void> | null = null;
  let renewing: Promise<boolean> | null = null;
  const cycle = async () => {
    if (!(await sampler.elect())) return;
    void checkProbeResources();
    const [probe, reconciliation] = await Promise.allSettled([
      deps.probe(),
      deps.store.reconcileRoundCheckInAttempts(100),
    ]);
    await sampler.sample({
      publicProbeHealthy:
        reconciliation.status === 'fulfilled' &&
        probe.status === 'fulfilled' &&
        probe.value,
    });
  };
  let lease = startingLease(nowMs());
  const observe = (renewal: LeaseRenewal) => {
    lease = afterRenewal(lease, renewal);
  };
  /** Checked on every tick, so a renewal that hangs still counts as unproven. */
  const checkHealth = () => {
    const checked = checkLease(lease, nowMs());
    lease = checked.health;
    if (!checked.lapse) return;
    try {
      deps.lapsing(checked.lapse);
    } catch {
      /* Reporting a lapse never stops the renewals that end it. */
    }
  };
  const renew = () => {
    if (renewing) return renewing;
    const startedMs = nowMs();
    observe({ kind: 'started' });
    renewing = deps.store
      .renewServiceInstance({ instanceId: deps.instanceId, role: 'web' })
      .then((wrote) => {
        // A lease another role holds was not renewed: never pretend it was.
        if (!wrote)
          throw createAppError(
            'CONFLICT',
            'Service lease belongs to another role',
          );
        observe({ kind: 'renewed', startedMs });
        return true;
      })
      .catch((error: unknown) => {
        observe({ kind: 'failed', error });
        deps.failed();
        return false;
      })
      .finally(() => {
        renewing = null;
      });
    return renewing;
  };
  const tick = () => {
    if (stopped) return;
    checkHealth();
    const renewal = renew();
    if (running) return;
    running = renewal
      .then((renewed) => (renewed ? cycle() : undefined))
      .catch(() => {
        deps.failed();
      })
      .finally(() => {
        running = null;
      });
  };
  const timer = deps.timers.setInterval(async () => tick(), RENEW_INTERVAL_MS);
  tick();
  return {
    /** Settles once this process has checked the probe's resources at start. */
    probeChecked: checkProbeResources(),
    async stop() {
      stopped = true;
      deps.timers.clearInterval(timer);
      await Promise.all([running, renewing]);
      await sampler.close();
    },
  };
}
