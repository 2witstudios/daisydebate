import { createAppError } from '@daisy/errors';
import {
  subscriptionStalenessTargetMs,
  type SubscriptionFreshness,
} from '../features/billing/subscription-staleness';
import type { App } from './app';

export function recordDisabledSubscriptionFreshness(app: Pick<App, 'logger'>) {
  try {
    app.logger.log(
      'billing.subscription.staleness',
      {
        cause: 'disabled',
        scope: 'disabled',
        stalenessTargetMs: subscriptionStalenessTargetMs,
      },
      'Subscription freshness collection is disabled',
    );
  } catch {
    /* A disabled worker must not start because its diagnostic sink failed. */
  }
}

/** Private aggregate sink. No customer, account, subscription or cursor leaves the collector. */
export function subscriptionStalenessObserver(
  app: Pick<App, 'logger'>,
  failed: (error: unknown, stage: string) => void,
) {
  let lastStatus: string | undefined;
  return {
    observed(value: SubscriptionFreshness) {
      const { status, targetMs, complete, ...facts } = value;
      try {
        app.logger.log(
          'billing.subscription.staleness',
          {
            ...facts,
            cause: status,
            scope: complete ? 'observed_pass' : 'partial',
            stalenessTargetMs: targetMs,
          },
          'Bounded subscription data freshness',
        );
      } catch (error) {
        failed(error, 'staleness_log');
      }
      if (
        status !== lastStatus &&
        (status === 'stale' || status === 'unavailable')
      )
        failed(
          createAppError(
            'INFRASTRUCTURE',
            'Subscription freshness is not within its target',
          ),
          'staleness_target',
        );
      lastStatus = status;
    },
    unavailable(error: unknown) {
      try {
        app.logger.log(
          'billing.subscription.staleness',
          {
            cause: 'unavailable',
            scope: 'unknown',
            stalenessTargetMs: subscriptionStalenessTargetMs,
          },
          'Subscription freshness collection is unavailable',
        );
      } catch {
        /* The existing failure sink independently attempts logging and reporting. */
      }
      if (lastStatus !== 'unavailable') failed(error, 'staleness_collect');
      lastStatus = 'unavailable';
    },
  };
}
