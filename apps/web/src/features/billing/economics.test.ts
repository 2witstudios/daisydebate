import { assert, setupRitewayBun, test } from 'riteway/bun';
import { evaluateMonthlyMargin } from './economics';
setupRitewayBun();
const measured = (amountMicros: number) => ({
  kind: 'measured' as const,
  amountMicros,
});
const report = (models = 7000000) => ({
  plan: 'premium',
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2026-11-01T00:00:00.000Z',
  floorBasisPoints: 3000,
  revenueAfterRefunds: measured(10000000),
  costs: {
    models: measured(models),
    speech: measured(0),
    recording: measured(0),
    broadcast: measured(0),
    storage: measured(0),
    paymentFees: measured(0),
    shared: measured(0),
    freeTierSubsidy: measured(0),
  },
});
const now = '2026-11-05T12:00:00.000Z';
test('completed measured Premium months distinguish the exact thirty-percent floor from a one-micro crossing', () => {
  const outcomes = [6999999, 7000000, 7000001].map((cost) =>
    evaluateMonthlyMargin(report(cost), now),
  );
  assert({
    given:
      'USD10 net recognized revenue and complete attributed measured costs just below, exactly at and just above USD7',
    should:
      'alert only below the provisional thirty-percent contribution margin, with exact integer money',
    actual: outcomes.map((value) => value.kind),
    expected: ['healthy', 'healthy', 'below_floor'],
  });
});
test('missing floor or any required cost never becomes a healthy margin, while estimates and nonpositive revenue remain explicit', () => {
  const input = report();
  const cases = [
    { ...input, floorBasisPoints: null },
    {
      ...input,
      costs: {
        ...input.costs,
        storage: { kind: 'unknown', reason: 'not_measured' },
      },
    },
    {
      ...input,
      costs: {
        ...input.costs,
        models: { kind: 'estimated', amountMicros: 7000000 },
      },
    },
    { ...input, revenueAfterRefunds: measured(0) },
    { ...input, revenueAfterRefunds: measured(-1000) },
    { ...input, costs: { models: measured(0) } },
  ];
  assert({
    given:
      'unmeasured storage, an unspecified floor, an estimate, refunded-away revenue or omitted cost categories',
    should:
      'retain uncertainty and refuse an invented measured pass or a ratio on nonpositive revenue',
    actual: cases.map((value) => evaluateMonthlyMargin(value, now).kind),
    expected: [
      'unknown',
      'unknown',
      'estimate',
      'no_ratio',
      'no_ratio',
      'unknown',
    ],
  });
});
test('only completed exact UTC months qualify for a measured margin verdict', () => {
  const input = report(9000000);
  const current = {
    ...input,
    startsAt: '2026-11-01T00:00:00.000Z',
    endsAt: '2026-12-01T00:00:00.000Z',
  };
  const future = {
    ...input,
    startsAt: '2026-12-01T00:00:00.000Z',
    endsAt: '2027-01-01T00:00:00.000Z',
  };
  assert({
    given:
      'a current month below the floor, a future month, a partial month and the precise completed-month boundary',
    should:
      'keep the current month an estimate and refuse invalid windows rather than treating a Room concurrency bound as monthly spend evidence',
    actual: [
      evaluateMonthlyMargin(current, now).kind,
      evaluateMonthlyMargin(future, now).kind,
      evaluateMonthlyMargin(
        { ...input, startsAt: '2026-10-02T00:00:00.000Z' },
        now,
      ).kind,
      evaluateMonthlyMargin(input, input.endsAt).kind,
    ],
    expected: ['estimate', 'unknown', 'unknown', 'below_floor'],
  });
});
test('integer-safe money and complete cost attribution remain required even at extreme magnitudes', () => {
  const input = {
    ...report(),
    revenueAfterRefunds: measured(Number.MAX_SAFE_INTEGER),
  };
  const below = {
    ...input,
    costs: { ...input.costs, models: measured(6305039478318694) },
  };
  const above = {
    ...input,
    costs: { ...input.costs, models: measured(6305039478318693) },
  };
  const invalid = [
    { ...input, costs: { ...input.costs, models: measured(0.5) } },
    { ...input, revenueAfterRefunds: measured(Number.MAX_SAFE_INTEGER + 1) },
    {
      ...input,
      costs: {
        ...input.costs,
        models: measured(Number.MAX_SAFE_INTEGER),
        storage: measured(1),
      },
    },
  ];
  assert({
    given:
      'a micro-unit threshold at safe-integer scale, fractional micro-units, unsafe money or overflowing totals',
    should:
      'compare exact totals and keep invalid accounting unknown, with no silent zero or floating-point rounding across the floor',
    actual: [
      evaluateMonthlyMargin(above, now).kind,
      evaluateMonthlyMargin(below, now).kind,
      ...invalid.map((value) => evaluateMonthlyMargin(value, now).kind),
    ],
    expected: ['healthy', 'below_floor', 'unknown', 'unknown', 'unknown'],
  });
});

test('attributed expense credits remain signed measurements without unsafe contribution output', () => {
  const input = report(-1);
  const result = evaluateMonthlyMargin(input, now);
  assert({
    given:
      'a fully measured expense credit and a positive completed-month revenue',
    should:
      'retain the signed credit rather than silently discarding it as free cost, while keeping the arithmetic exact',
    actual: [
      result.kind,
      'contributionMicros' in result && result.contributionMicros,
    ],
    expected: ['healthy', 10000001],
  });
});

test('UTC calendar windows include leap February and year rollover without accepting partial periods or personal metadata', () => {
  const windows = [
    ['2024-02-01T00:00:00.000Z', '2024-03-01T00:00:00.000Z'],
    ['2025-12-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    ['2024-02-01T00:00:00.000Z', '2024-02-29T00:00:00.000Z'],
  ];
  const privateInput = { ...report(), userId: 'not-an-analytics-dimension' };
  const refused = evaluateMonthlyMargin(privateInput, now);
  assert({
    given:
      'exact calendar months versus rolling/partial windows and an unexpected personal dimension',
    should:
      'assess only complete UTC months and return a fixed refusal without echoing private input',
    actual: [
      windows.map(
        ([startsAt, endsAt]) =>
          evaluateMonthlyMargin({ ...report(), startsAt, endsAt }, now).kind,
      ),
      refused,
      JSON.stringify(refused).includes(privateInput.userId),
    ],
    expected: [
      ['healthy', 'healthy', 'unknown'],
      { kind: 'unknown', reason: 'invalid_input' },
      false,
    ],
  });
});
