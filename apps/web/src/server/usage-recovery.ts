import type { App } from './app';
import type { WorkerTimers } from '../lib/worker-timers';
import { createUsageRecovery } from '../features/billing/usage-recovery';
import { startRunSchedule } from './run-schedule';
import { workerFailures } from './recoverable-failure';

/** Recovers local abandoned allowance independently of vendor and provider availability. */
export function startUsageRecovery(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly timers: WorkerTimers;
}) {
  return startRunSchedule({
    work: createUsageRecovery({
      store: input.app.database,
      instanceId: input.instanceId,
      failed: workerFailures(input.app, input.app.reporter)(
        'billing.usage_recovery.failed',
        'billing.usage_recovery',
        'Abandoned allowance recovery remains pending',
      ),
    }),
    timers: input.timers,
    intervalMs: 30_000,
    runOnStart: true,
  });
}
