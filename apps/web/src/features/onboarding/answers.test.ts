import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { interestCategoryChoices } from '@daisy/protocol';
import { emptyAnswers, parseStepAnswers } from './answers';

setupRitewayBun();

describe('parseStepAnswers', () => {
  test('the about step', () => {
    assert({
      given: 'two wants, a club choice and the club’s name',
      should: 'accept them, trimming the name',
      actual: parseStepAnswers({
        step: 'about',
        wants: ['watch', 'debate'],
        club: 'joining',
        clubName: ' Nova Academy ',
      }),
      expected: {
        ok: true,
        value: {
          step: 'about',
          wants: ['watch', 'debate'],
          club: 'joining',
          clubName: 'Nova Academy',
        },
      },
    });
    assert({
      given: 'no wants and no club',
      should: 'accept an empty answer rather than refuse',
      actual: parseStepAnswers({ step: 'about' }),
      expected: {
        ok: true,
        value: { step: 'about', wants: [], club: null, clubName: null },
      },
    });
    assert({
      given: 'a club name that is only spaces, or a two-line one',
      should: 'store nothing for the blank and refuse the line break',
      actual: [
        parseStepAnswers({ step: 'about', club: 'joining', clubName: '   ' }),
        parseStepAnswers({
          step: 'about',
          club: 'joining',
          clubName: 'A\r\nB',
        }),
      ],
      expected: [
        {
          ok: true,
          value: { step: 'about', wants: [], club: 'joining', clubName: null },
        },
        { ok: false, reason: 'invalid-value' },
      ],
    });
    assert({
      given: 'a want outside the four',
      should: 'refuse with no partial answer',
      actual: parseStepAnswers({ step: 'about', wants: ['debate', 'admin'] }),
      expected: { ok: false, reason: 'invalid-value' },
    });
    assert({
      given: 'the same want twice',
      should: 'refuse as repeated',
      actual: parseStepAnswers({ step: 'about', wants: ['judge', 'judge'] }),
      expected: { ok: false, reason: 'repeated-value' },
    });
  });

  test('the experience step', () => {
    assert({
      given: 'a level, a checked league and two typed ones',
      should:
        'merge the typed list with the chips, dropping an empty entry and keeping the first spelling of a repeat',
      actual: parseStepAnswers({
        step: 'experience',
        experience: 'circuit',
        leagues: ['NSDA'],
        leagueOther: 'Golden State, , NSDA, PhD',
      }),
      expected: {
        ok: true,
        value: {
          step: 'experience',
          experience: 'circuit',
          leagues: ['NSDA', 'Golden State', 'PhD'],
        },
      },
    });
    assert({
      given: 'a match length, quick or full',
      should: 'refuse it: Rounds are full length only (DEC-237, DEC-239)',
      actual: ['quick', 'full'].map((length) =>
        parseStepAnswers({ step: 'experience', experience: 'circuit', length }),
      ),
      expected: [
        { ok: false, reason: 'invalid-value' },
        { ok: false, reason: 'invalid-value' },
      ],
    });
    assert({
      given: 'a level that is not one of the four',
      should: 'refuse',
      actual: parseStepAnswers({ step: 'experience', experience: 'expert' }),
      expected: { ok: false, reason: 'invalid-value' },
    });
    assert({
      given: 'nothing chosen',
      should: 'accept nulls and an empty list',
      actual: parseStepAnswers({ step: 'experience' }),
      expected: {
        ok: true,
        value: {
          step: 'experience',
          experience: null,
          leagues: [],
        },
      },
    });
    assert({
      given: 'more than twelve leagues, or one longer than sixty characters',
      should: 'refuse',
      actual: [
        parseStepAnswers({
          step: 'experience',
          leagues: Array.from({ length: 13 }, (_, index) => `League ${index}`),
        }),
        parseStepAnswers({
          step: 'experience',
          leagues: ['L'.repeat(61)],
        }),
      ],
      expected: [
        { ok: false, reason: 'invalid-value' },
        { ok: false, reason: 'invalid-value' },
      ],
    });
  });

  test('the topics step', () => {
    assert({
      given: 'three listed topics',
      should: 'accept them',
      actual: parseStepAnswers({
        step: 'topics',
        topics: ['politics', 'philosophy', 'science-and-tech'],
      }),
      expected: {
        ok: true,
        value: {
          step: 'topics',
          topics: ['politics', 'philosophy', 'science-and-tech'],
        },
      },
    });
    assert({
      given: 'every listed topic',
      should: 'accept all twelve',
      actual: parseStepAnswers({
        step: 'topics',
        topics: [...interestCategoryChoices],
      }).ok,
      expected: true,
    });
    assert({
      given: 'a topic that is not listed',
      should: 'refuse',
      actual: parseStepAnswers({ step: 'topics', topics: ['astrology'] }),
      expected: { ok: false, reason: 'invalid-value' },
    });
  });

  test('the shape of the input', () => {
    assert({
      given: 'an unknown step',
      should: 'refuse the step',
      actual: parseStepAnswers({ step: 'age', wants: [] }),
      expected: { ok: false, reason: 'unknown-step' },
    });
    assert({
      given: 'a field that belongs to another step',
      should: 'refuse it rather than drop it',
      actual: parseStepAnswers({ step: 'topics', wants: ['debate'] }),
      expected: { ok: false, reason: 'invalid-value' },
    });
    assert({
      given: 'a list where one value is expected',
      should: 'refuse',
      actual: parseStepAnswers({ step: 'about', club: ['own'] }),
      expected: { ok: false, reason: 'invalid-value' },
    });
    assert({
      given: 'something that is not an object',
      should: 'refuse the step',
      actual: parseStepAnswers('about'),
      expected: { ok: false, reason: 'unknown-step' },
    });
  });
});

describe('emptyAnswers', () => {
  test('a member who answered nothing', () => {
    assert({
      given: 'no stored answers',
      should: 'be empty lists and nulls',
      actual: emptyAnswers,
      expected: {
        wants: [],
        club: null,
        clubName: null,
        experience: null,
        leagues: [],
        topics: [],
        completedAt: null,
      },
    });
  });
});
