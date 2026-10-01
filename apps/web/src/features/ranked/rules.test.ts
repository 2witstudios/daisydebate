import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { rankedRules } from './rules';

setupRitewayBun();

const rules = rankedRules({ provisionalDebates: 10, checkInGraceSeconds: 40 });

describe('rankedRules', () => {
  test('four rules, in reading order', () => {
    assert({
      given: 'the facts',
      should: 'state standard rules, judge, conduct and how it works',
      actual: rules.map(({ id }) => id),
      expected: ['standard-rules', 'assigned-judge', 'conduct', 'how-it-works'],
    });
  });

  test('the copy states the injected facts', () => {
    const copy = rules.map(({ body }) => body).join(' ');
    assert({
      given: 'a grace of 40 seconds and 10 provisional debates',
      should: 'state both numbers, a forfeit and only casual custom rules',
      actual: [
        copy.includes('within 40 seconds'),
        copy.includes('finish 10 ranked debates'),
        copy.includes('forfeit'),
        copy.includes('Only casual tables can use custom rules'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('no format is named', () => {
    assert({
      given: 'the rules copy',
      should: 'never name a debate format or style',
      actual: /lincoln|douglas|public forum|parliamentary|format/i.test(
        rules.map(({ body, title }) => `${title} ${body}`).join(' '),
      ),
      expected: false,
    });
  });
});
