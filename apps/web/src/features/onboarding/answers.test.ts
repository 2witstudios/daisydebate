import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { topicChoices } from '@daisy/protocol';
import { emptyAnswers, parseStepAnswers, parseStoredAnswers } from './answers';

setupRitewayBun();

describe('parseStepAnswers', () => {
  test('the about step', () => {
    assert({
      given: 'two wants and a club choice',
      should: 'accept them in the order given',
      actual: parseStepAnswers({
        step: 'about',
        wants: ['watch', 'debate'],
        club: 'joining',
      }),
      expected: {
        ok: true,
        value: { step: 'about', wants: ['watch', 'debate'], club: 'joining' },
      },
    });
    assert({
      given: 'no wants and no club',
      should: 'accept an empty answer rather than refuse',
      actual: parseStepAnswers({ step: 'about' }),
      expected: { ok: true, value: { step: 'about', wants: [], club: null } },
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
      given: 'a level, both formats and a length',
      should: 'accept them',
      actual: parseStepAnswers({
        step: 'experience',
        experience: 'circuit',
        formats: ['one-on-one', 'teams'],
        length: 'full',
      }),
      expected: {
        ok: true,
        value: {
          step: 'experience',
          experience: 'circuit',
          formats: ['one-on-one', 'teams'],
          length: 'full',
        },
      },
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
          formats: [],
          length: null,
        },
      },
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
      actual: parseStepAnswers({ step: 'topics', topics: [...topicChoices] })
        .ok,
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
        experience: null,
        formats: [],
        length: null,
        topics: [],
        completedAt: null,
      },
    });
  });
});

describe('parseStoredAnswers', () => {
  test('what the read endpoint returns', () => {
    const stored = {
      wants: ['debate'],
      club: 'own',
      experience: 'new',
      formats: [],
      length: null,
      topics: ['law'],
      completedAt: '2026-10-05T12:00:00.000Z',
    } as const;
    assert({
      given: 'stored answers on their lists',
      should: 'return them as answers',
      actual: parseStoredAnswers(stored),
      expected: stored,
    });
    assert({
      given: 'a stored value off its list, or a malformed time',
      should: 'refuse the whole read',
      actual: [
        parseStoredAnswers({ ...stored, club: 'secret' }),
        parseStoredAnswers({ ...stored, completedAt: 'yesterday' }),
        parseStoredAnswers('nothing'),
      ],
      expected: [null, null, null],
    });
  });
});
