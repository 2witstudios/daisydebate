import { assert, setupRitewayBun, test } from 'riteway/bun';
import { economicsSignals, raiseEconomicsSignals } from './economics-alert';
import { buildEconomicsReport } from './economics-report';
import { dataset, now } from './economics.test-support';
setupRitewayBun();

const captured = () => {
  const events: unknown[] = [];
  return {
    events,
    reporter: {
      capture: (error: unknown, context: unknown) => {
        events.push({
          message: error instanceof Error ? error.message : 'invalid',
          context,
        });
      },
    },
  };
};

test('a known crossing raises only fixed private low-margin and completeness signals', () => {
  const report = buildEconomicsReport(dataset(), now);
  const { events, reporter } = captured();
  const raised = raiseEconomicsSignals(reporter, {
    month: '2026-10',
    signals: economicsSignals(report),
  });
  assert({
    given:
      'a completed measured Premium month below the thirty-percent floor and missing free/beta measurements',
    should:
      'raise only fixed private low-margin/completeness signals correlated by month, without financial or personal dimensions',
    actual: [raised, events],
    expected: [
      { kind: 'submitted', alertDelivery: 'unconfirmed' },
      [
        {
          message: 'BILLING_ECONOMICS_INCOMPLETE',
          context: {
            route: 'billing.economics.free',
            errorCode: 'BILLING_ECONOMICS_INCOMPLETE',
            requestId: '2026-10',
          },
        },
        {
          message: 'BILLING_ECONOMICS_INCOMPLETE',
          context: {
            route: 'billing.economics.beta',
            errorCode: 'BILLING_ECONOMICS_INCOMPLETE',
            requestId: '2026-10',
          },
        },
        {
          message: 'BILLING_LOW_MARGIN',
          context: {
            route: 'billing.economics.premium',
            errorCode: 'BILLING_LOW_MARGIN',
            requestId: '2026-10',
          },
        },
      ],
    ],
  });
});

test('an invalid report is incomplete, correlated by its month', () => {
  const report = buildEconomicsReport({}, now);
  const { events, reporter } = captured();
  raiseEconomicsSignals(reporter, {
    month: '2026-10',
    signals: economicsSignals(report),
  });
  assert({
    given: 'a report the builder refused as invalid input',
    should:
      'raise one Premium completeness signal carrying the month, never a placeholder correlation value',
    actual: events,
    expected: [
      {
        message: 'BILLING_ECONOMICS_INCOMPLETE',
        context: {
          route: 'billing.economics.premium',
          errorCode: 'BILLING_ECONOMICS_INCOMPLETE',
          requestId: '2026-10',
        },
      },
    ],
  });
});

test('a throwing reporter is a failed submission carrying its cause', () => {
  const cause = new Error('private adapter');
  const raised = raiseEconomicsSignals(
    {
      capture: () => {
        throw cause;
      },
    },
    {
      month: '2026-10',
      signals: economicsSignals(buildEconomicsReport(dataset(), now)),
    },
  );
  assert({
    given: 'a reporter adapter that throws',
    should:
      'return a failed submission with the caught error, never suppress it',
    actual: raised,
    expected: { kind: 'failed', cause, submitted: 0 },
  });
});

test('a void reporter submission is not a delivery receipt', () => {
  const raised = raiseEconomicsSignals(
    { capture: () => undefined },
    {
      month: '2026-10',
      signals: economicsSignals(buildEconomicsReport(dataset(), now)),
    },
  );
  assert({
    given:
      'an existing void reporter port that may be inert without deployment keys',
    should:
      'keep operator delivery explicitly unconfirmed even after signal submission',
    actual: raised,
    expected: { kind: 'submitted', alertDelivery: 'unconfirmed' },
  });
});
