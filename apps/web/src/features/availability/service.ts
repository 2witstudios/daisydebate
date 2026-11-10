import type { WorkerTimers } from '../../lib/worker-timers';

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
/** How one lease renewal ended: the instance's own truth about its lease. */
export type LeaseRenewal =
  | {
      readonly kind: 'renewed';
      /** Monotonic ms from the call to its settling. */
      readonly tookMs: number;
    }
  | { readonly kind: 'failed'; readonly error: unknown };

/** Every peer renews its lease; only the actual elected session probes public ingress. */
export function startAvailabilityService(deps: {
  readonly instanceId: string;
  readonly store: {
    readonly renewServiceInstance: (input: {
      readonly instanceId: string;
      readonly role: 'web';
    }) => Promise<void>;
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
  /** Every renewal's outcome, so the instance knows whether its lease is current. */
  readonly renewal: (outcome: LeaseRenewal) => void;
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
  /** A renewal observer that throws never changes the renewal's outcome. */
  const observe = (outcome: LeaseRenewal) => {
    try {
      deps.renewal(outcome);
    } catch {
      /* Lease health is a report, never the lease itself. */
    }
  };
  const renew = () => {
    const startedMs = nowMs();
    renewing ??= deps.store
      .renewServiceInstance({ instanceId: deps.instanceId, role: 'web' })
      .then(
        () => {
          observe({ kind: 'renewed', tookMs: nowMs() - startedMs });
          return true;
        },
        (error: unknown) => {
          observe({ kind: 'failed', error });
          deps.failed();
          return false;
        },
      )
      .finally(() => {
        renewing = null;
      });
    return renewing;
  };
  const tick = () => {
    if (stopped) return;
    const lease = renew();
    if (running) return;
    running = lease
      .then((renewed) => (renewed ? cycle() : undefined))
      .catch(() => {
        deps.failed();
      })
      .finally(() => {
        running = null;
      });
  };
  const timer = deps.timers.setInterval(async () => tick(), 1000);
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
