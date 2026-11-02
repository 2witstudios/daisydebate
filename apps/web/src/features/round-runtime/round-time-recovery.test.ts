import { assert, setupRitewayBun, test } from 'riteway/bun';
import { driverEdges } from '../resource-sync/driver.test-support';
import { scheduleMediaDeadline } from '../round-media/schedule-deadline';
import { createRoundTime } from './round-time';
import { roundTimeNotice } from './round-time-notice';
import { sampleRoundTime } from './sample-round-time';
import { watchClockSuspension } from './watch-clock-suspension';
import { timingFixture } from './sample-round-time.test-support';
setupRitewayBun();

type Clock = { kind: 'found' | 'unavailable'; serverNowMs: number | null };
const found = (serverNowMs: number): Clock => ({ kind: 'found', serverNowMs });

test('a read that never settles cannot end sampling', async () => {
  const { edges, roundTime, read } = timingFixture<Clock>(10_000);
  const sampler = sampleRoundTime({
    ...edges,
    read,
    roundTime,
    random: () => 0.5,
  });
  edges.advance(2000);
  await edges.flush();
  assert({
    given: 'a read that passes the sample envelope without settling',
    should: 'abandon it, report no evidence and arm one retry',
    actual: [edges.reads(), edges.timers()],
    expected: [1, [2000]],
  });
  edges.advance(2000);
  await edges.flush();
  assert({
    given: 'that retry',
    should: 'issue a second read rather than wait on the first forever',
    actual: edges.reads(),
    expected: 2,
  });
  sampler.stop();
});

test('failed samples back off with jitter up to the settled cadence', async () => {
  const { edges, roundTime, read } = timingFixture<Clock>(10_000);
  const sampler = sampleRoundTime({
    ...edges,
    read,
    roundTime,
    random: () => 0.5,
  });
  const delays: number[] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    edges.answer({ kind: 'unavailable', serverNowMs: null });
    await edges.flush();
    const [delay] = edges.timers();
    delays.push(delay!);
    edges.advance(delay!);
  }
  assert({
    given: 'consecutive failed reads at the midpoint jitter value',
    should: 'double the retry delay and cap it at the settled cadence',
    actual: delays,
    expected: [2000, 4000, 8000, 16_000, 30_000, 30_000],
  });
  sampler.stop();
});

test('a hidden tab does not sample until it is visible again', async () => {
  const { edges, roundTime, read } = timingFixture<Clock>(10_000);
  const sampler = sampleRoundTime({
    ...edges,
    read,
    roundTime,
    random: () => 0.5,
  });
  edges.answer(found(100_000));
  await edges.flush();
  edges.hide();
  edges.advance(300_000);
  await edges.flush();
  assert({
    given: 'five hidden minutes after a healthy sample',
    should: 'issue no further read',
    actual: edges.reads(),
    expected: 1,
  });
  edges.show();
  assert({
    given: 'the tab returning',
    should: 'read at once',
    actual: edges.reads(),
    expected: 2,
  });
  sampler.stop();
});

test('a persistent server offset re-anchors while one outlier is refused', () => {
  let mono = 0;
  const clock = createRoundTime({
    monotonicNowMs: () => mono,
    hydrationSeedServerMs: 0,
  });
  let generation = 0;
  const at = (serverNowMs: number) =>
    clock.sample({
      serverNowMs,
      sentAtMs: mono,
      receivedAtMs: mono,
      generation: ++generation,
    }).accepted;
  at(50_000);
  mono = 1000;
  const outlier = at(47_000);
  mono = 2000;
  const recovered = at(52_000);
  const results = [];
  for (const step of [3000, 4000, 5000]) {
    mono = step;
    results.push(at(50_000 + step - 3000));
  }
  assert({
    given: 'one rolled-back reply among agreeing evidence',
    should: 'refuse it and keep the accepted authority',
    actual: [outlier, recovered],
    expected: [false, true],
  });
  assert({
    given: 'three fresh ordered samples agreeing on a server clock 3 s behind',
    should: 'accept the authority on the third and follow it',
    actual: [results, clock.nowMs(), clock.status().kind],
    expected: [[false, false, true], 52_000, 'current'],
  });
});

test('rollback samples that disagree with each other never re-anchor', () => {
  let mono = 0;
  const clock = createRoundTime({
    monotonicNowMs: () => mono,
    hydrationSeedServerMs: 0,
  });
  let generation = 0;
  const at = (serverNowMs: number) =>
    clock.sample({
      serverNowMs,
      sentAtMs: mono,
      receivedAtMs: mono,
      generation: ++generation,
    }).accepted;
  at(50_000);
  const results = [];
  for (const [step, offset] of [
    [1000, 3000],
    [2000, 9000],
    [3000, 3000],
    [4000, 9000],
  ] as const) {
    mono = step;
    results.push(at(50_000 + step - offset));
  }
  assert({
    given: 'rolled-back replies whose offsets disagree',
    should: 'refuse all of them',
    actual: results,
    expected: [false, false, false, false],
  });
});

test('a media boundary waits out the clock uncertainty', () => {
  const edges = driverEdges<never>();
  const clock = createRoundTime({
    monotonicNowMs: edges.scheduler.now,
    hydrationSeedServerMs: 0,
  });
  const sent = edges.scheduler.now();
  edges.advance(1000);
  clock.sample({
    serverNowMs: 9500,
    sentAtMs: sent,
    receivedAtMs: edges.scheduler.now(),
    generation: 2,
  });
  let fired = 0;
  const stop = scheduleMediaDeadline({
    deadlineMs: 11_000,
    roundTime: clock,
    scheduler: edges.scheduler,
    refresh: () => fired++,
  });
  edges.advance(1000);
  const atEstimate = [clock.nowMs(), fired];
  edges.advance(500);
  assert({
    given: 'an accepted estimate of 10000 ±500 and a boundary at 11000',
    should: 'not fire at the estimate, only once its lower bound has passed',
    actual: [atEstimate, fired],
    expected: [[11_000, 0], 1],
  });
  stop();
});

test('a slower reply that agrees cannot loosen a tighter anchor', () => {
  let mono = 0;
  const clock = createRoundTime({
    monotonicNowMs: () => mono,
    hydrationSeedServerMs: 0,
  });
  clock.sample({
    serverNowMs: 50_000,
    sentAtMs: 0,
    receivedAtMs: 0,
    generation: 1,
  });
  mono = 40_000;
  clock.sample({
    serverNowMs: 89_500,
    sentAtMs: 39_000,
    receivedAtMs: 40_000,
    generation: 2,
  });
  assert({
    given: 'an exact anchor and an agreeing reply measured at ±500',
    should: 'keep the anchor and its uncertainty, and count as fresh evidence',
    actual: [clock.nowMs(), clock.status()],
    expected: [90_000, { kind: 'current', uncertaintyMs: 0 }],
  });
  mono = 71_000;
  assert({
    given: 'thirty-one seconds after that agreeing reply',
    should: 'still be current, because the reply renewed the evidence',
    actual: clock.status().kind,
    expected: 'current',
  });
});

test('a Round the caller can no longer read ends the retry chain', async () => {
  const { edges, roundTime, read } = timingFixture<{
    kind: 'missing';
    serverNowMs: null;
  }>(10_000);
  const sampler = sampleRoundTime({
    ...edges,
    read,
    roundTime,
    random: () => 0.5,
  });
  edges.answer({ kind: 'missing', serverNowMs: null });
  await edges.flush();
  edges.advance(120_000);
  await edges.flush();
  assert({
    given: 'an authorized read answering missing',
    should: 'stop retrying rather than spend the read budget for the mount',
    actual: [edges.reads(), edges.timers()],
    expected: [1, []],
  });
  sampler.stop();
});

test('a jump between wall and monotonic time wakes the sampler', () => {
  const edges = driverEdges<never>();
  let wall = 1_000_000;
  let wakes = 0;
  const stop = watchClockSuspension({
    scheduler: edges.scheduler,
    wallNowMs: () => wall,
    onResume: () => wakes++,
  });
  wall += 5000;
  edges.advance(5000);
  const steady = wakes;
  wall += 600_000 + 5000;
  edges.advance(5000);
  stop();
  wall += 600_000;
  edges.advance(5000);
  assert({
    given: 'steady ticks, a ten-minute wall gap, then disposal',
    should: 'wake only on the gap and leave no timer',
    actual: [steady, wakes, edges.timers()],
    expected: [0, 1, []],
  });
});

test('a throttled timer is not a sleep, however far it stretches', () => {
  const { edges } = timingFixture<Clock>();
  let wall = 1_000_000;
  let wakes = 0;
  const stop = watchClockSuspension({
    scheduler: edges.scheduler,
    wallNowMs: () => wall,
    onResume: () => wakes++,
  });
  // The fixture's timers fire when advanced; both clocks move together.
  wall += 60_000;
  edges.advance(60_000);
  stop();
  assert({
    given: 'a tick stretched to a minute with the monotonic clock moving too',
    should: 'not call it a suspension',
    actual: wakes,
    expected: 0,
  });
});

test('a hidden tab ignores a wake and reads on its visibility return', async () => {
  const { edges, roundTime, read } = timingFixture<Clock>(10_000);
  const sampler = sampleRoundTime({
    ...edges,
    read,
    roundTime,
    random: () => 0.5,
  });
  edges.answer(found(10_000));
  await edges.flush();
  const before = edges.reads();
  edges.hide();
  sampler.wake();
  await edges.flush();
  const hidden = edges.reads();
  edges.show();
  await edges.flush();
  assert({
    given: 'a wake while hidden, then the tab returning',
    should: 'read only on the return',
    actual: [hidden - before, edges.reads() - before],
    expected: [0, 1],
  });
  sampler.stop();
});

test('a slow reply whose interval overlaps the anchor cannot move the display', () => {
  let monotonic = 0;
  const roundTime = createRoundTime({
    monotonicNowMs: () => monotonic,
    hydrationSeedServerMs: 10_000,
  });
  monotonic = 80;
  roundTime.sample({
    serverNowMs: 100_000,
    sentAtMs: 0,
    receivedAtMs: 80,
    generation: 1,
  });
  monotonic = 5000;
  const projected = roundTime.nowMs();
  const sentAtMs = monotonic;
  monotonic += 1900;
  // Stamped late in its round trip: the midpoint overstates by 960, within
  // the sum of both uncertainties (950 + 40) though outside its own 950.
  roundTime.sample({
    serverNowMs: projected + 1900 + 10,
    sentAtMs,
    receivedAtMs: monotonic,
    generation: 2,
  });
  assert({
    given: 'an agreeing slow reply just outside its own interval',
    should: 'keep the tighter anchor and its reading',
    actual: [roundTime.nowMs() - projected, roundTime.status().uncertaintyMs],
    expected: [1900, 40],
  });
});

test('the clock notice announces only its state, never the changing number', () => {
  assert({
    given: 'two synchronized statuses whose uncertainty differs',
    should: 'keep one announcement and carry the number apart',
    actual: [
      roundTimeNotice({ kind: 'current', uncertaintyMs: 12 }),
      roundTimeNotice({ kind: 'current', uncertaintyMs: 17 }),
      roundTimeNotice({ kind: 'stale', uncertaintyMs: 17 }).detail,
      roundTimeNotice({ kind: 'seed', uncertaintyMs: null }).detail,
    ],
    expected: [
      { announcement: 'Round clock synchronized', detail: '±12 ms' },
      { announcement: 'Round clock synchronized', detail: '±17 ms' },
      null,
      null,
    ],
  });
});
