import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readRoundClock } from './read-round-clock';
import { createMeasuredRead, createRoundTime } from './round-time';
setupRitewayBun();

const url = '/api/rounds/round/ballots';
const read = (header: string | null, status = 200) =>
  readRoundClock(
    async () =>
      new Response('{}', {
        status,
        headers: header === null ? {} : { 'x-server-now-ms': header },
      }),
    url,
  );

test('blank clock metadata cannot promote the hydration seed into accepted time', async () => {
  const clock = createRoundTime({
    monotonicNowMs: () => 1000,
    hydrationSeedServerMs: 10000,
  });
  const sampled = createMeasuredRead({
    read: () => read(''),
    roundTime: clock,
    monotonicNowMs: () => 1000,
    nextGeneration: () => 1,
  });
  const result = await sampled();
  assert({
    given: 'an authorized read carrying an empty server clock header',
    should:
      'retain an untrusted seed instead of accepting a fabricated zero instant',
    actual: [
      result.serverNowMs,
      clock.status().kind,
      clock.nowMs(),
      clock.calibration().real,
    ],
    expected: [null, 'seed', 10000, false],
  });
});

test('clock header decoding distinguishes missing metadata from an explicit zero instant', async () => {
  const values = await Promise.all(
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
    ].map(async (header) => (await read(header)).serverNowMs),
  );
  assert({
    given: 'missing, blank and malformed metadata beside explicit instants',
    should: 'return no evidence for malformed metadata, keeping explicit zero',
    actual: values,
    expected: [
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
  });
});

test('the clock read reports refusal and transport failure without an instant', async () => {
  const header = '1730000000000';
  const seen: { url: string; init: RequestInit }[] = [];
  const signal = new AbortController().signal;
  await readRoundClock(
    async (requested, init) => {
      seen.push({ url: requested, init });
      return new Response('{}');
    },
    url,
    signal,
  );
  assert({
    given: 'a clock read with a caller signal',
    should: 'GET the authorized route and carry the signal',
    actual: [seen[0]?.url, seen[0]?.init.method, seen[0]?.init.signal],
    expected: [url, 'GET', signal],
  });
  assert({
    given: 'a missing Round, a server failure and a failed transport',
    should: 'never report an instant from those replies',
    actual: [
      await read(header, 404),
      await read(header, 503),
      await readRoundClock(async () => {
        throw new TypeError('network');
      }, url),
    ],
    expected: [
      { kind: 'missing', serverNowMs: null },
      { kind: 'unavailable', serverNowMs: null },
      { kind: 'unavailable', serverNowMs: null },
    ],
  });
});

test('malformed clock metadata preserves an accepted anchor and read generation ordering', async () => {
  const clock = createRoundTime({
    monotonicNowMs: () => 1000,
    hydrationSeedServerMs: 10000,
  });
  let generation = 0;
  let header = '10000';
  const sampled = createMeasuredRead({
    read: () => read(header),
    roundTime: clock,
    monotonicNowMs: () => 1000,
    nextGeneration: () => ++generation,
  });
  await sampled();
  const before = structuredClone(clock.calibration());
  const observations = [];
  for (const malformed of [
    '',
    '0x10',
    '1e3',
    '1.5',
    '-1',
    '8640000000000001',
  ]) {
    header = malformed;
    await sampled();
    observations.push([clock.calibration(), clock.status().kind, generation]);
  }
  assert({
    given: 'an accepted anchor followed by malformed metadata',
    should: 'retain the anchor, mark stale and consume each request generation',
    actual: observations,
    expected: Array.from({ length: 6 }, (_, i) => [before, 'stale', i + 2]),
  });
  header = '10000';
  await sampled();
  assert({
    given: 'the next valid read after refused metadata',
    should: 'accept only the later measured read generation',
    actual: clock.calibration().generation,
    expected: 8,
  });
});
