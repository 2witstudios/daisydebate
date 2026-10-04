import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  customRulesHref,
  customRulesView,
  parseCustomRulesQuery,
  ruleSetLinks,
  saveRuleSetHref,
} from './custom-rules';

setupRitewayBun();

const sample = parseCustomRulesQuery({});

describe('parseCustomRulesQuery', () => {
  test('opens on the sample rule set', () => {
    assert({
      given: 'no parameters',
      should: 'show 7 minute speeches named Longer speeches, unsaved',
      actual: sample,
      expected: {
        rules: { speechMinutes: 7, prepMinutes: 4, seats: 'both' },
        name: 'Longer speeches',
        saved: false,
        ranked: false,
        plan: { mins: 20, did: [] },
      },
    });
  });

  test('bad values fall back, names are trimmed and cut', () => {
    const query = parseCustomRulesQuery({
      speech: '99',
      prep: 'x',
      seats: 'many',
      name: `  ${'n'.repeat(80)}  `,
    });
    assert({
      given: 'a 99 minute speech, a bad prep, bad seats and a long name',
      should: 'clamp, default and cut to 40 characters',
      actual: [query.rules, query.name.length],
      expected: [{ speechMinutes: 12, prepMinutes: 4, seats: 'both' }, 40],
    });
  });

  test('a blank name falls back to the sample', () => {
    assert({
      given: 'a name of spaces',
      should: 'use the sample name',
      actual: parseCustomRulesQuery({ name: '   ' }).name,
      expected: 'Longer speeches',
    });
  });
});

describe('customRulesView', () => {
  test('steppers link one minute either way and stop at the ends', () => {
    const [speech] = customRulesView(sample).steppers;
    const atMin = customRulesView(parseCustomRulesQuery({ speech: '1' }));
    const atMax = customRulesView(parseCustomRulesQuery({ prep: '10' }));
    assert({
      given: 'speech 7, speech 1 and prep 10',
      should: 'offer 6 and 8, no shorter at 1, no longer at 10',
      actual: [
        speech?.shorterHref,
        speech?.longerHref,
        atMin.steppers[0].shorterHref,
        atMax.steppers[1].longerHref,
      ],
      expected: [
        '/train/rules?speech=6&prep=4&seats=both&name=Longer+speeches',
        '/train/rules?speech=8&prep=4&seats=both&name=Longer+speeches',
        null,
        null,
      ],
    });
  });

  test('changing a rule clears saved and the ranked refusal', () => {
    const query = parseCustomRulesQuery({ saved: '1', ranked: '1' });
    const view = customRulesView(query);
    assert({
      given: 'a saved set with the ranked refusal open',
      should: 'show both, and a stepper link that shows neither',
      actual: [
        view.saved,
        view.ranked !== null,
        view.steppers[0].longerHref?.includes('saved'),
        view.steppers[0].longerHref?.includes('ranked'),
      ],
      expected: [true, true, false, false],
    });
  });

  test('custom and standard rules', () => {
    const standard = customRulesView(
      parseCustomRulesQuery({ speech: '5', prep: '4' }),
    );
    assert({
      given: 'standard values, then the sample',
      should: 'say custom only for the sample and list its difference',
      actual: [
        standard.custom,
        standard.differences,
        customRulesView(sample).custom,
        customRulesView(sample).differences,
      ],
      expected: [false, [], true, ['Speech 7 min (standard 5)']],
    });
  });

  test('seats and the practice link', () => {
    const solo = customRulesView(parseCustomRulesQuery({ seats: 'solo' }));
    assert({
      given: 'a solo seat',
      should: 'mark it selected and start a solo practice with these rules',
      actual: [solo.seats.map((s) => s.selected), solo.practiceHref],
      expected: [[false, true], '/train/practice?opp=solo&speech=7&seats=solo'],
    });
  });

  test('the ranked refusal gives the reasons for the rules', () => {
    const view = customRulesView(
      parseCustomRulesQuery({ ranked: '1', seats: 'solo' }),
    );
    assert({
      given: 'custom times and a solo seat, ranked asked for',
      should: 'refuse for both reasons',
      actual: view.ranked?.reasons.length,
      expected: 2,
    });
  });

  test('links carry the plan back', () => {
    const query = parseCustomRulesQuery({ mins: '10', did: 'review' });
    assert({
      given: 'a ten minute plan with review done',
      should: 'return to that plan and keep it in links',
      actual: [
        customRulesView(query).backHref,
        saveRuleSetHref(query),
        customRulesHref(query),
      ],
      expected: [
        '/train?mins=10&did=review',
        '/train/rules?speech=7&prep=4&seats=both&name=Longer+speeches&saved=1&mins=10&did=review',
        '/train/rules?speech=7&prep=4&seats=both&name=Longer+speeches&mins=10&did=review',
      ],
    });
  });
});

describe('ruleSetLinks', () => {
  test('each set starts a practice under its rules', () => {
    assert({
      given: 'a long-speech set and a solo set',
      should: 'link to set-up with their rules, solo choosing no opponent',
      actual: ruleSetLinks(
        [
          {
            id: 'a',
            name: 'Longer speeches',
            rules: { speechMinutes: 7, prepMinutes: 4, seats: 'both' },
          },
          {
            id: 'b',
            name: 'Solo, one side',
            rules: { speechMinutes: 5, prepMinutes: 4, seats: 'solo' },
          },
        ],
        { mins: 20, did: [] },
      ).map((link) => link.href),
      expected: [
        '/train/practice?speech=7',
        '/train/practice?opp=solo&seats=solo',
      ],
    });
  });
});
