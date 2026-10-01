import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { defaultConfig } from './practice';
import {
  buildTurns,
  effectiveOpponent,
  lengthLabel,
  opponentTurnAt,
  resolveSide,
  turnAt,
} from './turns';

setupRitewayBun();

describe('resolveSide', () => {
  test('a chosen side stays, a random one follows the coin', () => {
    assert({
      given: 'aff, neg and random with both coin faces',
      should: 'keep a choice and use the coin for random',
      actual: [
        resolveSide({ ...defaultConfig, side: 'neg' }, true),
        resolveSide({ ...defaultConfig, side: 'random' }, true),
        resolveSide({ ...defaultConfig, side: 'random' }, false),
      ],
      expected: ['neg', 'aff', 'neg'],
    });
  });
});

describe('buildTurns', () => {
  test('against the AI as Aff', () => {
    const turns = buildTurns(defaultConfig, 'aff');
    assert({
      given: 'Aff against the AI debater',
      should: 'give you the odd turns and name them in order',
      actual: turns.map((t) => [t.name, t.who]),
      expected: [
        ['Turn 1: Aff speech', 'You'],
        ['Turn 2: Neg speech', 'AI debater'],
        ['Turn 3: Aff speech', 'You'],
        ['Turn 4: Neg speech', 'AI debater'],
        ['Turn 5: Aff speech', 'You'],
      ],
    });
  });

  test('against the AI as Neg', () => {
    assert({
      given: 'Neg against the AI debater',
      should: 'give you the even turns',
      actual: buildTurns(defaultConfig, 'neg').map((t) => t.speaker),
      expected: ['opponent', 'you', 'opponent', 'you', 'opponent'],
    });
  });

  test('driving both sides', () => {
    assert({
      given: 'both sides driven by you',
      should: 'make every turn yours',
      actual: buildTurns({ ...defaultConfig, opponent: 'both' }, 'aff').every(
        (t) => t.speaker === 'you',
      ),
      expected: true,
    });
  });

  test('solo runs only your side, keeping stable positions', () => {
    const turns = buildTurns({ ...defaultConfig, opponent: 'solo' }, 'neg');
    assert({
      given: 'solo speeches as Neg',
      should: 'keep only the Neg turns, numbered 1 and 2 but seq 2 and 4',
      actual: turns.map((t) => [t.name, t.seq]),
      expected: [
        ['Turn 1: Neg speech', 2],
        ['Turn 2: Neg speech', 4],
      ],
    });
  });

  test('custom solo seats mean solo whatever the opponent', () => {
    const config = {
      ...defaultConfig,
      rules: { ...defaultConfig.rules, seats: 'solo' },
    } as const;
    assert({
      given: 'rules with one seat and an AI opponent chosen',
      should: 'run solo',
      actual: [effectiveOpponent(config), buildTurns(config, 'aff').length],
      expected: ['solo', 3],
    });
  });

  test('length follows the rules', () => {
    const turns = buildTurns(
      { ...defaultConfig, rules: { ...defaultConfig.rules, speechMinutes: 7 } },
      'aff',
    );
    assert({
      given: 'seven minute speeches',
      should: 'label every turn 7:00',
      actual: [turns[0]?.lengthSeconds, turns[0] && lengthLabel(turns[0])],
      expected: [420, '7:00'],
    });
  });
});

describe('turnAt', () => {
  test('the next turn at or after a position, else the last', () => {
    const solo = buildTurns({ ...defaultConfig, opponent: 'solo' }, 'neg');
    assert({
      given: 'solo Neg turns (seq 2 and 4) and positions 1, 3 and 9',
      should: 'pick seq 2, 4 and then the last',
      actual: [1, 3, 9].map((seq) => turnAt(solo, seq)?.seq),
      expected: [2, 4, 4],
    });
    assert({
      given: 'no turns',
      should: 'find none',
      actual: turnAt([], 1),
      expected: null,
    });
  });
});

describe('opponentTurnAt', () => {
  test("the opponent's turn at or after a position, else their last", () => {
    const turns = buildTurns(defaultConfig, 'aff');
    assert({
      given: 'Aff against the AI and positions 1, 3 and 5',
      should: 'find seq 2, 4 and then the last opponent turn, 4',
      actual: [1, 3, 5].map((seq) => opponentTurnAt(turns, seq)?.seq),
      expected: [2, 4, 4],
    });
    assert({
      given: 'solo speeches, which have no opponent',
      should: 'find none',
      actual: opponentTurnAt(
        buildTurns({ ...defaultConfig, opponent: 'solo' }, 'aff'),
        1,
      ),
      expected: null,
    });
  });
});
