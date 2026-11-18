import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  effectiveHostingTier,
  eventAllowance,
  hostingEntryCap,
  hostingOffers,
  hostingUpgrade,
  isHostingTier,
} from './hosting-tier';
setupRitewayBun();

test('hostingEntryCap', () => {
  assert({
    given: 'each hosting tier',
    should: 'cap free at 16, the USD 99 tier at 64 and unlimited at none',
    actual: [
      hostingEntryCap('free'),
      hostingEntryCap('event_64'),
      hostingEntryCap('event_unlimited'),
    ],
    expected: [16, 64, null],
  });
});

test('eventAllowance: entries', () => {
  assert({
    given: 'a free tournament with 15 accepted entries',
    should: 'allow the 16th',
    actual: eventAllowance('free', 15, 'entry'),
    expected: { kind: 'allowed' },
  });
  assert({
    given: 'a free tournament with 16 accepted entries',
    should: 'require an upgrade for the 17th',
    actual: eventAllowance('free', 16, 'entry'),
    expected: { kind: 'upgrade_required', reason: 'entry-limit' },
  });
  assert({
    given: 'a USD 99 tournament with 63 accepted entries',
    should: 'allow the 64th',
    actual: eventAllowance('event_64', 63, 'entry'),
    expected: { kind: 'allowed' },
  });
  assert({
    given: 'a USD 99 tournament with 64 accepted entries',
    should: 'require an upgrade for the 65th',
    actual: eventAllowance('event_64', 64, 'entry'),
    expected: { kind: 'upgrade_required', reason: 'entry-limit' },
  });
  assert({
    given: 'an unlimited tournament with 10 000 accepted entries',
    should: 'allow another',
    actual: eventAllowance('event_unlimited', 10_000, 'entry'),
    expected: { kind: 'allowed' },
  });
});

test('eventAllowance: paid features', () => {
  assert({
    given: 'a free tournament',
    should: 'require an upgrade for recording, AI judging and broadcast',
    actual: (['recording', 'ai_judging', 'broadcast'] as const).map((feature) =>
      eventAllowance('free', 0, feature),
    ),
    expected: [
      { kind: 'upgrade_required', reason: 'recording' },
      { kind: 'upgrade_required', reason: 'ai_judging' },
      { kind: 'upgrade_required', reason: 'broadcast' },
    ],
  });
  assert({
    given: 'either paid tier',
    should: 'allow recording, AI judging and broadcast',
    actual: (['event_64', 'event_unlimited'] as const).flatMap((tier) =>
      (['recording', 'ai_judging', 'broadcast'] as const).map(
        (feature) => eventAllowance(tier, 64, feature).kind,
      ),
    ),
    expected: Array(6).fill('allowed'),
  });
});

test('hostingUpgrade', () => {
  assert({
    given: 'a free tournament',
    should: 'owe the full price of either paid tier',
    actual: [
      hostingUpgrade('free', 'event_64'),
      hostingUpgrade('free', 'event_unlimited'),
    ],
    expected: [
      { kind: 'owed', amount: 9900 },
      { kind: 'owed', amount: 19900 },
    ],
  });
  assert({
    given: 'a tournament already on the USD 99 tier moving to unlimited',
    should: 'owe only the USD 100 difference',
    actual: hostingUpgrade('event_64', 'event_unlimited'),
    expected: { kind: 'owed', amount: 10000 },
  });
  assert({
    given: 'a target at or below the tier already held',
    should: 'owe nothing',
    actual: [
      hostingUpgrade('event_64', 'event_64'),
      hostingUpgrade('event_unlimited', 'event_64'),
      hostingUpgrade('event_unlimited', 'event_unlimited'),
    ],
    expected: [{ kind: 'held' }, { kind: 'held' }, { kind: 'held' }],
  });
});

test('effectiveHostingTier', () => {
  assert({
    given: 'no paid purchase and no covering grant',
    should: 'be free',
    actual: effectiveHostingTier({ paidTiers: [], granted: false }),
    expected: 'free',
  });
  assert({
    given: 'paid purchases for USD 99 and then the difference to unlimited',
    should: 'be the highest tier paid',
    actual: [
      effectiveHostingTier({ paidTiers: ['event_64'], granted: false }),
      effectiveHostingTier({
        paidTiers: ['event_64', 'event_unlimited'],
        granted: false,
      }),
    ],
    expected: ['event_64', 'event_unlimited'],
  });
  assert({
    given: 'a current administrative hosting grant covering the tournament',
    should: 'be unlimited',
    actual: effectiveHostingTier({ paidTiers: [], granted: true }),
    expected: 'event_unlimited',
  });
});

test('hostingOffers and isHostingTier', () => {
  assert({
    given: 'the paid offers',
    should: 'name their Stripe lookup keys and amounts',
    actual: hostingOffers,
    expected: {
      event_64: { unitAmount: 9900, lookupKey: 'daisy_host_event_usd_99' },
      event_unlimited: {
        unitAmount: 19900,
        lookupKey: 'daisy_host_event_usd_199',
      },
    },
  });
  assert({
    given: 'tier names and other strings',
    should: 'recognise only the three tiers',
    actual: ['free', 'event_64', 'event_unlimited', 'premium'].map(
      isHostingTier,
    ),
    expected: [true, true, true, false],
  });
});
