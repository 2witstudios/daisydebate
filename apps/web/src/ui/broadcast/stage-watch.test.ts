import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { stageWatchStart, watchedStage } from './stage-watch';

setupRitewayBun();

const replay = (reads: readonly (readonly [number | null, number])[]) =>
  reads.reduce(
    (watch, [status, at]) => watchedStage(watch, status, at),
    stageWatchStart,
  ).ended;

describe('watchedStage', () => {
  test('a refusal on a stale heartbeat ends the Egress at once', () => {
    assert({
      given: 'one 410',
      should: 'end now',
      actual: replay([[410, 0]]),
      expected: true,
    });
  });
  test('about 10 s of failure ends it, whatever the failure looks like', () => {
    assert({
      given: 'no answer, 500s and 404s from 0 to 9.999 s, then to 10 s',
      should: 'end only at 10 s',
      actual: [
        replay([
          [null, 0],
          [500, 5000],
          [404, 9999],
        ]),
        replay([
          [null, 0],
          [500, 5000],
          [404, 10_000],
        ]),
      ],
      expected: [false, true],
    });
  });
  test('a good answer forgives what came before, and an end stands', () => {
    assert({
      given:
        '9 s failing, a good read, 9 s more; then a good read after an end',
      should: 'keep going, and stay ended',
      actual: [
        replay([
          [null, 0],
          [200, 9000],
          [null, 10_000],
          [null, 18_000],
        ]),
        replay([
          [410, 0],
          [200, 1000],
        ]),
      ],
      expected: [false, true],
    });
  });
});
