import { assert, setupRitewayBun, test } from 'riteway/bun';
import { round } from '../room-runtime/operations.test-support';
import { readRoundBallot } from '../round-ballots/reads';
import { readRoundReceipt } from './read-round';
import { createMeasuredRead, createRoundTime } from './round-time';
setupRitewayBun();

type ClockRead = {
  readonly kind: 'found' | 'missing' | 'unavailable';
  readonly serverNowMs?: number | null;
};
const readers: readonly ((header: string | null) => Promise<ClockRead>)[] = [
  (header) =>
    readRoundReceipt(
      async () =>
        Response.json(round, {
          headers: header === null ? {} : { 'x-server-now-ms': header },
        }),
      round.id,
    ),
  (header) =>
    readRoundBallot(
      async () =>
        Response.json(
          { round, own: null, freeze: null, ballots: [], transcript: null },
          { headers: header === null ? {} : { 'x-server-now-ms': header } },
        ),
      round.id,
    ),
];

test('blank clock metadata cannot promote the hydration seed into accepted time', async () => {
  const states = [];
  for (const reader of readers) {
    const clock = createRoundTime({
      monotonicNowMs: () => 1000,
      hydrationSeedServerMs: 10000,
    });
    const sampled = createMeasuredRead({
      read: () => reader(''),
      roundTime: clock,
      monotonicNowMs: () => 1000,
      nextGeneration: () => 1,
    });
    const result = await sampled();
    states.push([
      result.serverNowMs,
      clock.status().kind,
      clock.nowMs(),
      clock.calibration()?.real,
    ]);
  }
  assert({
    given:
      'valid authorized debater/spectator and judge bodies carrying an empty server clock header',
    should:
      'retain an untrusted seed instead of accepting a fabricated zero instant',
    actual: states,
    expected: [
      [null, 'seed', 10000, false],
      [null, 'seed', 10000, false],
    ],
  });
});

test('clock header decoding distinguishes missing metadata from an explicit zero instant', async () => {
  const values = [];
  for (const reader of readers)
    values.push(
      await Promise.all(
        [
          null,
          '',
          '   ',
          'NaN',
          'Infinity',
          '-1',
          '0x10',
          '1e3',
          '1.5',
          '8640000000000001',
          '0',
          '1730000000000',
        ].map(async (header) => (await reader(header)).serverNowMs),
      ),
    );
  assert({
    given:
      'missing, blank and non-finite metadata alongside explicit finite server instants',
    should:
      'return no clock evidence for malformed metadata while preserving explicit zero and real time',
    actual: values,
    expected: [
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        0,
        1730000000000,
      ],
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        0,
        1730000000000,
      ],
    ],
  });
});

test('malformed clock metadata preserves an accepted anchor and read generation ordering', async () => {
  const observations = [];
  for (const reader of readers) {
    const clock = createRoundTime({
      monotonicNowMs: () => 1000,
      hydrationSeedServerMs: 10000,
    });
    let generation = 0;
    let header = '10000';
    const read = createMeasuredRead({
      read: () => reader(header),
      roundTime: clock,
      monotonicNowMs: () => 1000,
      nextGeneration: () => ++generation,
    });
    await read();
    const before = structuredClone(clock.calibration());
    const status = { ...clock.status(), kind: 'stale' };
    for (const malformed of [
      '',
      '0x10',
      '1e3',
      '1.5',
      '-1',
      '8640000000000001',
    ]) {
      header = malformed;
      await read();
      observations.push([clock.calibration(), clock.status(), generation]);
    }
    assert({
      given:
        'an accepted anchor followed by malformed metadata through an actual reader',
      should:
        'retain the accepted anchor, visibly mark stale timing and consume each request generation',
      actual: observations.splice(0),
      expected: Array.from({ length: 6 }, (_, i) => [before, status, i + 2]),
    });
    header = '10000';
    await read();
    assert({
      given: 'the next valid read after refused metadata',
      should: 'accept only the later measured read generation',
      actual: clock.calibration()?.generation,
      expected: 8,
    });
  }
});
