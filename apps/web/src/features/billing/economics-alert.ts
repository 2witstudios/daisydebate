import type { ErrorReporter } from '@daisy/observability';
import type { EconomicsReport } from './economics-report';
import type { EconomicsPlan } from './economics-input';

/** A saved month's fixed private signal: a product statement about that month, never a worker failure. */
export type EconomicsSignal = {
  readonly name: 'BILLING_LOW_MARGIN' | 'BILLING_ECONOMICS_INCOMPLETE';
  readonly plan: EconomicsPlan;
};

/** Closed private signal names; no source financial details or participant identity reaches telemetry. */
export function economicsSignals(
  report: EconomicsReport,
): readonly EconomicsSignal[] {
  return report.plansReported.flatMap<EconomicsSignal>((plan) => {
    const margin = report.plans[plan].margin;
    if (margin.kind === 'below_floor')
      return [{ name: 'BILLING_LOW_MARGIN', plan }];
    if (margin.kind === 'unknown')
      return [{ name: 'BILLING_ECONOMICS_INCOMPLETE', plan }];
    return [];
  });
}

/**
 * Submit a saved report's signals, correlated only by its UTC month. A throwing
 * reporter is a failed submission with its cause and how many signals it took
 * before throwing, so a retry sends only the rest; never suppressed. A void
 * reporter's return is not an operator receipt, so delivery stays unconfirmed.
 */
export function raiseEconomicsSignals(
  reporter: ErrorReporter,
  input: {
    readonly month: string;
    readonly signals: readonly EconomicsSignal[];
  },
) {
  let submitted = 0;
  try {
    for (const signal of input.signals) {
      reporter.capture(new Error(signal.name), {
        route: `billing.economics.${signal.plan}`,
        errorCode: signal.name,
        requestId: input.month,
      });
      submitted++;
    }
  } catch (cause) {
    return { kind: 'failed', cause, submitted } as const;
  }
  return { kind: 'submitted', alertDelivery: 'unconfirmed' } as const;
}
