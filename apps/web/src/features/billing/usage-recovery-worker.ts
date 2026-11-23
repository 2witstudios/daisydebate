import { repeatEvery } from '@daisy/worker';
import type { Waits } from '@daisy/clock';
import type { App } from '../../server/app';
import { createUsageRecovery } from './usage-recovery';
import { workerFailures } from '../../server/recoverable-failure';

/** Recovers local abandoned allowance independently of vendor and provider availability. */
export function startUsageRecovery(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly waits: Waits;
}) {
  const work = createUsageRecovery({
    store: input.app.database,
    instanceId: input.instanceId,
    failed: workerFailures(input.app, input.app.reporter)(
      'billing.usage_recovery.failed',
      'billing.usage_recovery',
      'Abandoned allowance recovery remains pending',
    ),
  });
  return repeatEvery({
    run: (signal) => work.run(signal),
    waits: input.waits,
    everyMs: 30_000,
    runOnStart: true,
    // Each run reports its own failure.
    failed: () => undefined,
  });
}
