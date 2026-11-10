import type { ErrorReporter } from '@daisy/observability';
import type { buildEconomicsReport } from './economics-report';
import type { EconomicsPlan } from './economics-input';

/** A saved month's fixed private signal: a product statement about that month, never a worker failure. */
export type EconomicsSignal = {
  readonly name: 'BILLING_LOW_MARGIN' | 'BILLING_ECONOMICS_INCOMPLETE';
  readonly plan: EconomicsPlan;
};

/** Closed private signal names; no source financial details or participant identity reaches telemetry. */
export function economicsSignals(
  report: ReturnType<typeof buildEconomicsReport>,
): readonly EconomicsSignal[] {
  if (report.kind === 'invalid')
    return [{ name: 'BILLING_ECONOMICS_INCOMPLETE', plan: 'premium' }];
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
 * reporter is a failed submission with its cause, never suppressed; a void
 * reporter's return is not an operator receipt, so delivery stays unconfirmed.
 */
export function raiseEconomicsSignals(
  reporter: ErrorReporter,
  input: {
    readonly month: string;
    readonly signals: readonly EconomicsSignal[];
  },
) {
  try {
    for (const signal of input.signals)
      reporter.capture(new Error(signal.name), {
        route: `billing.economics.${signal.plan}`,
        errorCode: signal.name,
        requestId: input.month,
      });
  } catch (cause) {
    return { kind: 'failed', cause } as const;
  }
  return { kind: 'submitted', alertDelivery: 'unconfirmed' } as const;
}
