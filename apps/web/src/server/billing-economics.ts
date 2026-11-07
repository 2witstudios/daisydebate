import { createAppError } from '@daisy/errors';
import type { App } from './app';
import { createBillingEconomicsCollector } from '../features/billing/economics-collector';
import {
  hasRecordedEconomicsFloor,
  previousEconomicsMonth,
} from '../features/billing/economics-policy';
import { createBillingEconomicsFiles } from './billing-economics-files';
import { workerFailures } from './recoverable-failure';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../lib/worker-timers';

/** Current-service source and private filesystem remain explicit; absent inputs never become measured zero. */
export function composeBillingEconomics(app: App, instanceId: string) {
  const directory = app.config.BILLING_ECONOMICS_DIRECTORY;
  const files =
    directory === undefined
      ? null
      : createBillingEconomicsFiles({
          directory,
          nextId: () => app.ids.next(),
          now: () => app.clock.now(),
        });
  return createBillingEconomicsCollector({
    store: app.database.billingEconomics(instanceId),
    feed: {
      read: async (window) => {
        const value = files ? await files.feed.read(window) : null;
        if (!hasRecordedEconomicsFloor(value))
          throw createAppError('VALIDATION');
        return value;
      },
    },
    save: files
      ? (report) => files.save(report)
      : async () => {
          throw createAppError('INFRASTRUCTURE');
        },
    reporter: app.reporter,
    now: () => app.clock.now(),
  });
}

/** One bounded monthly read per tick; late original-month correction can use the same explicit collector. */
export function startBillingEconomics(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly timers: WorkerTimers;
}) {
  const { app } = input;
  const collector = composeBillingEconomics(app, input.instanceId);
  const failed = workerFailures(app, app.reporter)(
    'billing.economics.failed',
    'billing.economics',
    'Private billing economics remain incomplete',
  );
  return startSingleFlightWorker({
    timers: input.timers,
    everyMs: 3_600_000,
    failed: (error) => failed(error, 'collect'),
    run: async () => {
      const window = previousEconomicsMonth(app.clock.now());
      if (!window) throw createAppError('VALIDATION');
      const result = await collector.run(window);
      if (result.kind === 'failed')
        failed(createAppError('INFRASTRUCTURE'), 'collect');
    },
  });
}
