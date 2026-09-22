import { formatRulesSchema } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { formatSeedVersion, formatSeeds } from './format-seed';

setupRitewayBun();

describe('formatSeeds', () => {
  test('seed the unjudged foundation format with valid rules', () => {
    const foundation = formatSeeds.find((format) => format.id === 'foundation');
    assert({
      given: 'the foundation format seed',
      should:
        'pass the protocol rules schema with one seat per side and no judge',
      actual: {
        parsed: formatRulesSchema.safeParse(foundation?.rules).success,
        seats: foundation?.rules.seats,
        rankedEligible: foundation?.rankedEligible,
      },
      expected: {
        parsed: true,
        seats: { affirmative: 1, negative: 1, judge: 0 },
        rankedEligible: false,
      },
    });
  });

  test('every seeded rules value passes the protocol schema', () => {
    assert({
      given: 'all format seeds',
      should: 'each validate against formatRulesSchema',
      actual: formatSeeds.map(
        (format) => formatRulesSchema.safeParse(format.rules).success,
      ),
      expected: formatSeeds.map(() => true),
    });
  });

  test('carries its first durable version marker', () => {
    assert({
      given: 'the format seed content',
      should: 'name the seed_versions marker for this content',
      actual: formatSeedVersion,
      expected: 'format-seed-v1',
    });
  });
});
