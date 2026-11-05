import { assert, setupRitewayBun, test } from 'riteway/bun';
import type {
  PlatformUsageCredit,
  UsageEvent,
  UsageKind,
  UsageState,
  UsageTransition,
} from '@daisy/protocol/billing';
import { advanceUsage } from './usage-lifecycle';

setupRitewayBun();
const admittedAt = '2026-11-05T00:00:00.000Z';
const countedAt = '2026-11-05T00:01:00.000Z';
const creditedAt = '2026-12-05T00:00:00.000Z';
const incidents: readonly PlatformUsageCredit[] = [
  { kind: 'recovery_bound', incidentId: 'incident_owned' },
  { kind: 'capture_shortfall', commandId: 'command_owned', freezeRevision: 1 },
];
const run = (
  state: UsageState,
  event: UsageEvent,
  kind: UsageKind = 'ai_round',
) =>
  advanceUsage(
    { kind, state, admittedAt, dispatchBefore: '2026-11-05T01:00:00.000Z' },
    event,
    {
      now: creditedAt,
      authorized: false,
    },
  );
const credit = (provenance = incidents[0]!) =>
  ({ kind: 'platform_credit', provenance }) as const;
const credited: UsageState = {
  kind: 'credited',
  countedAt,
  creditedAt,
  provenance: incidents[0]!,
  providerOutcome: 'unknown',
};
const failed: UsageEvent = { kind: 'settle', outcome: 'definite_failure' };
const stateOf = (result: UsageTransition): UsageState => {
  if (result.kind === 'refuse')
    throw new Error('Expected accounting transition');
  return result.state;
};

test('qualifying platform credits retain delivered and unknown provider evidence', () => {
  assert({
    given:
      'each existing platform ending after dispatched, delivered or unknown bot calls',
    should:
      'credit the original count without asserting provider failure, including after account revocation or period end',
    actual: incidents.flatMap((provenance) =>
      (['dispatched', 'delivered', 'unknown'] as const).map((kind) =>
        run({ kind, countedAt }, credit(provenance)),
      ),
    ),
    expected: incidents.flatMap((provenance) =>
      (['dispatched', 'delivered', 'unknown'] as const).map(
        (providerOutcome): UsageTransition => ({
          kind: 'changed',
          state: {
            kind: 'credited',
            countedAt,
            creditedAt,
            provenance,
            providerOutcome,
          },
        }),
      ),
    ),
  });
});

test('mixed provider-failure and platform-credit order restores allowance only once', () => {
  const dispatched: UsageState = { kind: 'unknown', countedAt };
  const refundFirst = stateOf(run(dispatched, failed));
  const platformFirst = stateOf(run(dispatched, credit()));
  assert({
    given:
      'definite failure and platform credit in both orders, with duplicate and differing platform reasons',
    should:
      'retain the first restoration and original count while allowing honest later provider accounting',
    actual: [
      run(refundFirst, credit()),
      run(platformFirst, failed),
      run(platformFirst, credit()),
      run(platformFirst, credit(incidents[1]!)),
    ],
    expected: [
      { kind: 'unchanged', state: refundFirst },
      {
        kind: 'changed',
        state: { ...credited, providerOutcome: 'definite_failure' },
      },
      { kind: 'unchanged', state: platformFirst },
      { kind: 'unchanged', state: platformFirst },
    ],
  });
});

test('platform credit cannot restore uncounted use or cascade into judging or analysis', () => {
  assert({
    given: 'uncounted/released bot work, or counted judge and analysis work',
    should: 'refuse every credit and leave each separate reservation untouched',
    actual: [
      run({ kind: 'reserved' }, credit()),
      run({ kind: 'released', releasedAt: countedAt }, credit()),
      run({ kind: 'delivered', countedAt }, credit(), 'casual_ai_judge'),
      run({ kind: 'unknown', countedAt }, credit(), 'round_analysis'),
    ],
    expected: Array.from({ length: 4 }, () => ({ kind: 'refuse' })),
  });
});

test('credited unknown exposure can settle without reopening dispatch or erasing delivery', () => {
  const delivered = { ...credited, providerOutcome: 'delivered' as const };
  assert({
    given:
      'unknown credited work later succeeds, duplicates, or claims an inconsistent failure',
    should:
      'preserve credit provenance/count and refuse inconsistent delivery rewrites',
    actual: [
      run(credited, { kind: 'settle', outcome: 'delivered' }),
      run(delivered, { kind: 'settle', outcome: 'delivered' }),
      run(delivered, failed),
      advanceUsage(
        {
          kind: 'ai_round',
          state: { ...credited, creditedAt: countedAt },
          admittedAt,
          dispatchBefore: creditedAt,
        },
        { kind: 'dispatch' },
        { now: countedAt, authorized: true },
      ),
    ],
    expected: [
      { kind: 'changed', state: delivered },
      { kind: 'unchanged', state: delivered },
      { kind: 'refuse' },
      { kind: 'refuse' },
    ],
  });
});
