import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  backToTrainHref,
  debriefFields,
  debriefHref,
  debriefView,
  defaultDebriefQuery,
  parseDebriefQuery,
} from './debrief';
import { defaultConfig } from './practice';
import { defaultHubQuery } from './query';

setupRitewayBun();

describe('parseDebriefQuery', () => {
  test('defaults', () => {
    assert({
      given: 'no parameters',
      should: 'cover the whole debate with nothing saved',
      actual: parseDebriefQuery({}),
      expected: defaultDebriefQuery,
    });
  });

  test('valid and bad values', () => {
    assert({
      given: 'a speech, saved ids with an unknown and a repeat, and flags',
      should: 'keep known ids once and read the flags',
      actual: parseDebriefQuery({
        upto: '3',
        speech: '2',
        saved: ['a0', 'a0', 'zz', 'a1'],
        save: '1',
        sent: '1',
      }),
      expected: {
        upto: 3,
        speech: 2,
        saved: ['a0', 'a1'],
        saveAttempted: true,
        feedbackSent: true,
      },
    });
    assert({
      given: 'nonsense numbers',
      should: 'fall back',
      actual: parseDebriefQuery({ upto: 'x', speech: '-1' }),
      expected: defaultDebriefQuery,
    });
  });
});

describe('debriefView', () => {
  test('a full debate', () => {
    const view = debriefView(defaultConfig, 'aff', defaultDebriefQuery);
    assert({
      given: 'all three of your speeches as Aff',
      should: 'total the samples and list each speech with its notes',
      actual: [
        view.stats.map((s) => s.value),
        view.speeches.map((s) => s.name),
        view.speeches.map((s) => s.used),
        view.selected?.name,
        view.work.length,
        view.arguments.map((a) => [a.id, a.checked]),
        view.intro,
      ],
      expected: [
        ['3 of 4', '4 of 5', '96%'],
        [
          'Turn 1: your Aff speech',
          'Turn 3: your Aff speech',
          'Turn 5: your Aff speech',
        ],
        ['4:24 of 5:00', '5:00 used, 12 s over', '5:00 used'],
        'Turn 1: your Aff speech',
        3,
        [
          ['a0', true],
          ['a1', true],
          ['a2', false],
        ],
        'You were Aff, against the AI debater, on a sample motion.',
      ],
    });
  });

  test('ended early', () => {
    const view = debriefView(defaultConfig, 'aff', {
      ...defaultDebriefQuery,
      upto: 3,
    });
    assert({
      given: 'a debate ended before turn 3',
      should: 'count only the first speech and offer fewer items',
      actual: [
        view.speeches.length,
        view.work.length,
        view.arguments.map((a) => a.id),
        view.stats[0]?.detail,
        view.stats[2]?.detail,
      ],
      expected: [
        1,
        1,
        ['a0', 'a1'],
        'claim, warrant and impact',
        'across your one speech',
      ],
    });
  });

  test('ended before any speech', () => {
    const view = debriefView(defaultConfig, 'aff', {
      ...defaultDebriefQuery,
      upto: 1,
    });
    assert({
      given: 'a debate ended on turn 1',
      should: 'be empty with nothing to save or work on',
      actual: [
        view.empty,
        view.speeches,
        view.selected,
        view.work,
        view.arguments,
      ],
      expected: [true, [], null, [], []],
    });
  });

  test('selecting a speech, clamped to those given', () => {
    const view = debriefView(defaultConfig, 'aff', {
      ...defaultDebriefQuery,
      speech: 9,
    });
    assert({
      given: 'a speech index past the last',
      should: 'show the last speech',
      actual: [view.selected?.name, view.speeches.map((s) => s.selected)],
      expected: ['Turn 5: your Aff speech', [false, false, true]],
    });
  });

  test('saving', () => {
    const saved = debriefView(defaultConfig, 'aff', {
      ...defaultDebriefQuery,
      saved: ['a1'],
      saveAttempted: true,
    });
    const none = debriefView(defaultConfig, 'aff', {
      ...defaultDebriefQuery,
      saveAttempted: true,
    });
    assert({
      given: 'one argument saved, and a save pressed with none chosen',
      should: 'count the saved one and only flag the empty save',
      actual: [
        saved.savedCount,
        saved.arguments.map((a) => a.checked),
        saved.saveError,
        none.saveError,
      ],
      expected: [1, [false, true, false], false, true],
    });
  });

  test('Neg, your own motion and solo', () => {
    const view = debriefView(
      { ...defaultConfig, motion: 3, opponent: 'solo' },
      'neg',
      defaultDebriefQuery,
    );
    assert({
      given: 'solo Neg on your own motion',
      should: 'name the side, the solo work and your own motion',
      actual: [view.intro, view.speeches.length],
      expected: ['You were Neg, working solo, on your own motion.', 2],
    });
  });
});

describe('debrief links and fields', () => {
  const plan = { mins: 10, did: ['review'] } as const;

  test('a speech link keeps the rest of the state', () => {
    assert({
      given: 'a debrief ended at turn 3 with feedback sent, opening speech 1',
      should: 'keep upto and sent and the plan',
      actual: debriefHref(
        defaultConfig,
        plan,
        { ...defaultDebriefQuery, upto: 3, feedbackSent: true },
        { speech: 1 },
      ),
      expected:
        '/train/practice/debrief?upto=3&speech=1&sent=1&mins=10&did=review',
    });
  });

  test('form fields carry config, plan and, when asked, the saved arguments', () => {
    const query = { ...defaultDebriefQuery, saved: ['a0', 'a1'] };
    assert({
      given: 'two saved arguments',
      should: 'include them only when the form keeps them',
      actual: [
        debriefFields({ ...defaultConfig, side: 'neg' }, plan, query, {
          saved: false,
        }),
        debriefFields(defaultConfig, defaultHubQuery, query, { saved: true }),
      ],
      expected: [
        [
          ['side', 'neg'],
          ['mins', '10'],
          ['did', 'review'],
        ],
        [
          ['saved', 'a0'],
          ['saved', 'a1'],
        ],
      ],
    });
  });

  test('back to Train counts a practice that gave a speech', () => {
    assert({
      given: 'a debrief with and without a speech',
      should: 'mark guided practice done only with a speech',
      actual: [backToTrainHref(plan, true), backToTrainHref(plan, false)],
      expected: [
        '/train?mins=10&did=review%2Cguided-practice',
        '/train?mins=10&did=review',
      ],
    });
  });
});
