import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  clampPrep,
  clampSpeech,
  describeDifferences,
  isStandard,
  rankedRefusal,
  standardRules,
} from './rules';

setupRitewayBun();

describe('rules', () => {
  test('standard rules differ from nothing', () => {
    assert({
      given: 'the standard rules',
      should: 'be standard with no differences',
      actual: [isStandard(standardRules), describeDifferences(standardRules)],
      expected: [true, []],
    });
  });

  test('differences are described', () => {
    assert({
      given: 'longer speeches, more prep and a solo seat',
      should: 'name each difference against the standard value',
      actual: describeDifferences({
        speechMinutes: 7,
        prepMinutes: 6,
        seats: 'solo',
      }),
      expected: [
        'Speech length is 7 min. The standard rules use 5.',
        'Prep time is 6 min. The standard rules use 4.',
        'Only one seat is filled, so nobody answers.',
      ],
    });
  });

  test('ranked refuses custom and solo rules, and always says why', () => {
    assert({
      given: 'custom times, a solo seat and the standard rules',
      should: 'give the matching reasons, and a general one for standard',
      actual: [
        rankedRefusal({ ...standardRules, speechMinutes: 7 }),
        rankedRefusal({ ...standardRules, seats: 'solo' }),
        rankedRefusal(standardRules).length,
      ],
      expected: [
        ['Ranked runs only the standard rules. These rules are custom.'],
        [
          'Ranked needs a person in every seat. A solo or sandbox seat is for practice only.',
        ],
        1,
      ],
    });
  });

  test('clamps', () => {
    assert({
      given: 'values outside the ranges and a fraction',
      should: 'stay inside 1 to 12 and 0 to 10 minutes',
      actual: [clampSpeech(0), clampSpeech(99), clampPrep(-3), clampPrep(4.6)],
      expected: [1, 12, 0, 5],
    });
  });
});
