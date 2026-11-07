import type { ErrorReporter } from '@daisy/observability';
import { buildEconomicsReport } from './economics-report';
import type { EconomicsPlan } from './economics-input';

type EconomicsSignal = {
  readonly name: 'BILLING_LOW_MARGIN' | 'BILLING_ECONOMICS_INCOMPLETE';
  readonly plan: EconomicsPlan;
};

/** Closed private signal names; no source financial details or participant identity reaches telemetry. */
export function economicsSignals(
  report: ReturnType<typeof buildEconomicsReport>,
): readonly EconomicsSignal[] {
  if (report.kind === 'invalid')
    return [
      {
        name: 'BILLING_ECONOMICS_INCOMPLETE' as const,
        plan: 'premium' as const,
      },
    ];
  return report.plansReported.flatMap<EconomicsSignal>((plan) => {
    const margin = report.plans[plan].margin;
    if (margin.kind === 'below_floor')
      return [{ name: 'BILLING_LOW_MARGIN' as const, plan }];
    if (margin.kind === 'unknown')
      return [{ name: 'BILLING_ECONOMICS_INCOMPLETE' as const, plan }];
    return [];
  });
}
/** Persist the private report before attempting alerts. A sink/reporter failure is returned to the caller for retry, never suppressed. */
export async function runEconomicsReport(input: {
  readonly read: () => Promise<unknown>;
  readonly save: (
    report: ReturnType<typeof buildEconomicsReport>,
  ) => Promise<void>;
  readonly reporter: ErrorReporter;
  readonly now: () => string;
}) {
  try {
    const report = buildEconomicsReport(await input.read(), input.now());
    await input.save(report);
    const signals = economicsSignals(report);
    for (const signal of signals)
      input.reporter.capture(new Error(signal.name), {
        route: `billing.economics.${signal.plan}`,
        errorCode: signal.name,
        requestId:
          report.kind === 'report' ? report.startsAt.slice(0, 7) : 'invalid',
      });
    return {
      kind: 'reported',
      report,
      signals,
      alertDelivery: 'unconfirmed',
    } as const;
  } catch {
    try {
      input.reporter.capture(new Error('BILLING_ECONOMICS_INCOMPLETE'), {
        route: 'billing.economics.premium',
        errorCode: 'BILLING_ECONOMICS_INCOMPLETE',
        requestId: 'delivery-failed',
      });
    } catch {
      return { kind: 'failed', reason: 'economics_delivery_failed' } as const;
    }
    return { kind: 'failed', reason: 'economics_delivery_failed' } as const;
  }
}
