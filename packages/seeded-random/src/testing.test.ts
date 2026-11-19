import fc from 'fast-check';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { seededCheck, seededWalk } from './testing';

setupRitewayBun();

describe('seededCheck', () => {
  test('a property that holds reports no failure', () => {
    assert({
      given: 'a hundred integers and a property every one meets',
      should: 'report no failure after every run',
      actual: seededCheck({
        seed: 1,
        runs: 100,
        input: fc.integer(),
        problems: (value) => (value + 0 === value ? [] : ['sum changed']),
      }),
      expected: { failure: null, runs: 100 },
    });
  });

  test('a failing property reports its smallest case, the same on every run', () => {
    const check = () =>
      seededCheck({
        seed: 7,
        runs: 200,
        input: fc.nat(),
        problems: (value) => (value >= 50 ? [`${value} is too large`] : []),
      }).failure;
    const failure = check();
    assert({
      given: 'a property that fails from 50 up',
      should: 'name 50, the smallest failing case, and replay it identically',
      actual: {
        smallest: failure?.endsWith(': 50 is too large'),
        seeded: failure?.startsWith('seed 7, path '),
        replays: check() === failure,
      },
      expected: { smallest: true, seeded: true, replays: true },
    });
  });

  test('a property that throws reports the throw', () => {
    assert({
      given: 'a property that throws',
      should: 'report the error, not pass',
      actual: seededCheck({
        seed: 3,
        runs: 10,
        input: fc.constant(0),
        problems: () => {
          throw new Error('broken');
        },
      }).failure?.endsWith('threw Error: broken'),
      expected: true,
    });
  });
});

/** A counter walk: up or down by one; the walk fails once it reaches `limit`. */
const counter = (limit: number, steps = 40) =>
  seededWalk({
    seed: 11,
    runs: 100,
    steps,
    start: () => 0,
    moves: () => ['up', 'down'] as const,
    label: (move) => move,
    step: (state, move) => {
      const next = move === 'up' ? state + 1 : state - 1;
      return {
        state: next,
        problems: next >= limit ? [`reached ${next}`] : [],
      };
    },
  });

describe('seededWalk', () => {
  test('a walk that holds its invariant reports no failure', () => {
    assert({
      given: 'a counter walk that can never reach its limit',
      should: 'report no failure',
      actual: counter(1000).failure,
      expected: null,
    });
  });

  test('a failing walk shrinks to its shortest trace', () => {
    assert({
      given: 'a counter walk that fails once it climbs to 3',
      should: 'report the three steps up that reach it',
      actual: counter(3).failure?.split(': ').slice(1).join(': '),
      expected: 'reached 3 after up > up > up',
    });
  });

  test('a walk ends when no move is offered', () => {
    let steps = 0;
    const report = seededWalk({
      seed: 5,
      runs: 20,
      steps: 50,
      start: () => 0,
      moves: (state) => (state < 2 ? ['next'] : []),
      label: (move) => move,
      step: (state) => {
        steps += 1;
        return { state: state + 1, problems: [] };
      },
    });
    assert({
      given: 'a walk that offers moves only for its first two steps',
      should: 'take at most two steps a run and hold',
      actual: { failure: report.failure, bounded: steps <= 2 * 20 },
      expected: { failure: null, bounded: true },
    });
  });

  test('a step that draws more than it may is a failure in the test', () => {
    const report = seededWalk({
      seed: 5,
      runs: 5,
      steps: 1,
      start: () => 0,
      moves: () => ['greedy'],
      label: (move) => move,
      step: (state, _move, draw) => {
        for (let index = 0; index < 7; index += 1) draw(10);
        return { state, problems: [] };
      },
    });
    assert({
      given: 'a step that draws seven times',
      should: 'fail naming the draw limit',
      actual: report.failure?.includes('drew more than 6 times'),
      expected: true,
    });
  });
});
