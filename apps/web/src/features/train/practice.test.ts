import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { defaultHubQuery } from './query';
import {
  configParams,
  defaultConfig,
  motionText,
  parsePracticeConfig,
  practiceHref,
  practiceSummary,
} from './practice';

setupRitewayBun();

describe('parsePracticeConfig', () => {
  test('defaults', () => {
    assert({
      given: 'no parameters',
      should: 'be Aff against the AI on the first motion, standard rules',
      actual: parsePracticeConfig({}),
      expected: defaultConfig,
    });
  });

  test('valid values', () => {
    assert({
      given: 'a neg solo practice with custom rules and coaching off',
      should: 'read every choice',
      actual: parsePracticeConfig({
        side: 'neg',
        motion: '3',
        own: '  Zoos should close.  ',
        opp: 'solo',
        coach: 'off',
        hints: 'on',
        speech: '7',
        prep: '0',
        seats: 'solo',
      }),
      expected: {
        side: 'neg',
        motion: 3,
        own: 'Zoos should close.',
        opponent: 'solo',
        coach: false,
        hints: true,
        rules: { speechMinutes: 7, prepMinutes: 0, seats: 'solo' },
      },
    });
  });

  test('bad values fall back', () => {
    assert({
      given: 'nonsense for every parameter',
      should: 'return the defaults',
      actual: parsePracticeConfig({
        side: 'both',
        motion: '9',
        opp: 'robot',
        coach: 'maybe',
        speech: 'abc',
        prep: '-1',
        seats: 'many',
      }),
      expected: defaultConfig,
    });
  });

  test('out of range times are clamped, long motions cut', () => {
    const parsed = parsePracticeConfig({
      speech: '99',
      prep: '99',
      motion: '3',
      own: 'x'.repeat(500),
    });
    assert({
      given: 'times of 99 and a 500 character motion',
      should: 'cap to 12 and 10 minutes and 140 characters',
      actual: [
        parsed.rules.speechMinutes,
        parsed.rules.prepMinutes,
        parsed.own.length,
      ],
      expected: [12, 10, 140],
    });
  });

  test('the last of a repeated parameter wins', () => {
    assert({
      given: 'coach=off then coach=on, as a hidden default then a choice',
      should: 'use the later value',
      actual: parsePracticeConfig({ coach: ['off', 'on'] }).coach,
      expected: true,
    });
  });
});

describe('configParams and practiceHref', () => {
  test('only non-defaults are written', () => {
    assert({
      given: 'the default and a changed config',
      should: 'write nothing, then only what changed',
      actual: [
        configParams(defaultConfig).toString(),
        configParams({
          ...defaultConfig,
          side: 'neg',
          hints: false,
          rules: { speechMinutes: 7, prepMinutes: 4, seats: 'both' },
        }).toString(),
      ],
      expected: ['', 'side=neg&hints=off&speech=7'],
    });
  });

  test('round trip', () => {
    const config = {
      ...defaultConfig,
      side: 'random',
      motion: 3,
      own: 'Zoos should close.',
      opponent: 'both',
      coach: false,
    } as const;
    assert({
      given: 'a config written to a URL',
      should: 'read back to the same config',
      actual: parsePracticeConfig(
        Object.fromEntries(configParams(config).entries()),
      ),
      expected: config,
    });
  });

  test('links carry config, extras and the plan', () => {
    assert({
      given: 'a live link with a turn, for a ten minute plan',
      should: 'join config, extra and plan context',
      actual: practiceHref(
        '/train/practice/live',
        { ...defaultConfig, side: 'neg' },
        { mins: 10, did: ['review'] },
        { turn: '3' },
      ),
      expected: '/train/practice/live?side=neg&turn=3&mins=10&did=review',
    });
    assert({
      given: 'the default config and plan',
      should: 'be the bare path',
      actual: practiceHref('/train/practice', defaultConfig, defaultHubQuery),
      expected: '/train/practice',
    });
  });
});

describe('summary', () => {
  test('rows and note', () => {
    const summary = practiceSummary({
      ...defaultConfig,
      side: 'random',
      opponent: 'both',
      hints: false,
    });
    assert({
      given: 'a random side, both seats and hints off',
      should: 'say each choice and the sandbox-seat note',
      actual: [summary.rows.map(([, value]) => value), summary.note],
      expected: [
        [
          'Random, picked at the start',
          'Cities should fund public transit before roads.',
          'You, on both sides (two sandbox seats)',
          'Coach prompts on, hints off',
          'Standard rules',
        ],
        'Two sandbox seats are made for you. Nobody else can join.',
      ],
    });
  });

  test('an own motion with no words yet', () => {
    assert({
      given: 'the own-motion choice with nothing written',
      should: 'read as a prompt to write one',
      actual: motionText({ ...defaultConfig, motion: 3 }),
      expected: 'Your own motion',
    });
  });
});
