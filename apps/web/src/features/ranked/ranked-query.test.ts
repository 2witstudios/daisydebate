import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  defaultRankedQuery,
  parseRankedQuery,
  rankedHref,
  stepHref,
} from './ranked-query';

setupRitewayBun();

describe('parseRankedQuery', () => {
  test('no parameters is the hub', () => {
    assert({
      given: 'an empty query',
      should: 'show the hub with the rules closed',
      actual: parseRankedQuery({}),
      expected: defaultRankedQuery,
    });
  });

  test('each step and the open rules', () => {
    assert({
      given: 'a step, and the rules flag',
      should: 'read the step, and the flag only on the hub',
      actual: [
        parseRankedQuery({ step: 'offer' }),
        parseRankedQuery({ rules: '1' }),
        parseRankedQuery({ step: 'search', rules: '1' }),
      ],
      expected: [
        { step: 'offer', rules: false },
        { step: 'hub', rules: true },
        { step: 'search', rules: false },
      ],
    });
  });

  test('untrusted values fall back', () => {
    assert({
      given: 'an unknown step, a junk flag and a repeated parameter',
      should: 'fall back to the defaults or the first value',
      actual: [
        parseRankedQuery({ step: 'bogus', rules: 'yes' }),
        parseRankedQuery({ step: ['ready', 'ended'] }),
        parseRankedQuery({ step: '' }),
      ],
      expected: [
        defaultRankedQuery,
        { step: 'ready', rules: false },
        defaultRankedQuery,
      ],
    });
  });
});

describe('rankedHref', () => {
  test('only non-default values appear', () => {
    assert({
      given: 'the hub, the open rules and a step',
      should: 'build the shortest URL',
      actual: [
        rankedHref(defaultRankedQuery),
        rankedHref({ step: 'hub', rules: true }),
        rankedHref({ step: 'search', rules: false }),
        stepHref('ended'),
      ],
      expected: [
        '/ranked',
        '/ranked?rules=1',
        '/ranked?step=search',
        '/ranked?step=ended',
      ],
    });
  });
});
