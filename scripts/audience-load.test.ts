import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  dueRequests,
  parseLoadPlan,
  summarizeFloorLog,
  summarizeLoad,
} from './audience-load';

setupRitewayBun();

const roundId = 'a'.repeat(24);

describe('parseLoadPlan', () => {
  test('a viewer count states its request rate', () => {
    assert({
      given: '1,000 viewers on a local server',
      should: 'poll two routes each every 2 s, 1,000 requests a second',
      actual: parseLoadPlan([
        '--origin',
        'http://localhost:3100',
        '--round',
        roundId,
        '--viewers',
        '1000',
        '--seconds',
        '60',
      ]),
      expected: {
        origin: 'http://localhost:3100',
        roundId,
        requestsPerSecond: 1000,
        seconds: 60,
      },
    });
  });

  test('it never loads a target it does not know to be expendable', () => {
    expect(() =>
      parseLoadPlan([
        '--origin',
        'https://daisydebate.com',
        '--round',
        roundId,
      ]),
    ).toThrow('Refusing to load https://daisydebate.com');
  });
});

describe('dueRequests', () => {
  test('the rate holds whatever the tick', () => {
    const paths = (elapsedMs: number, sent: number) =>
      dueRequests({ requestsPerSecond: 1000, elapsedMs, sent });
    assert({
      given: '10 ms at 1,000 a second with none sent, and 3 already sent',
      should: 'owe 10, then 7',
      actual: [paths(10, 0), paths(10, 3)],
      expected: [10, 7],
    });
    assert({
      given: 'a tick with more already sent than owed',
      should: 'owe none',
      actual: paths(10, 50),
      expected: 0,
    });
  });
});

describe('summarizeLoad', () => {
  test('it counts answers and states latency', () => {
    assert({
      given: 'answers, refusals and transport failures',
      should: 'count each and read latency percentiles from answered requests',
      actual: summarizeLoad(
        [
          ...Array.from({ length: 98 }, (_, index) => ({
            status: 200,
            durationMs: index + 1,
          })),
          { status: 503, durationMs: 1 },
          { status: 0, durationMs: 1 },
        ],
        { skipped: 2, seconds: 10 },
      ),
      expected: {
        sent: 100,
        skipped: 2,
        perSecond: 10,
        statuses: { '200': 98, '503': 1, '0': 1 },
        answeredMs: { p50: 49, p99: 98, max: 98 },
      },
    });
  });
});

describe('summarizeFloorLog', () => {
  const line = (fields: object) => JSON.stringify(fields);
  test('it reads the floor from plain and fly log lines, and nothing else', () => {
    const lines = [
      line({ event: 'round.media.floor_pass', durationMs: 10 }),
      line({ event: 'round.media.floor_pass', durationMs: 30, cause: 'x' }),
      line({ event: 'round.media.floor_waiting', cause: 'capacity' }),
      line({ event: 'round.media.floor_waiting', cause: 'lease' }),
      line({ event: 'round.media.floor_waiting', cause: 'lease' }),
      line({ event: 'round.media.floor_tick', durationMs: 5 }),
      line({ event: 'db.capacity.refused', cause: 'audience.saturated' }),
      line({ event: 'db.capacity.refused', cause: 'competitive.expired' }),
      line({ event: 'http.request.completed', durationMs: 999 }),
      line({
        message: line({ event: 'round.media.floor_pass', durationMs: 20 }),
      }),
      'not json',
    ];
    assert({
      given: 'a log with floor events, others and noise',
      should: 'summarize passes, waits by cause, ticks and refusals by lane',
      actual: summarizeFloorLog(lines),
      expected: {
        passes: 3,
        failedPasses: 1,
        passMs: { p50: 20, p99: 30, max: 30 },
        waitingByCause: { capacity: 1, lease: 2 },
        tickMs: { p50: 5, p99: 5, max: 5 },
        refusedByLane: { audience: 1, competitive: 1 },
      },
    });
  });
});
