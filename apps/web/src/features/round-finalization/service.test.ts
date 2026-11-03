import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startRoundMaintenance } from './service';
import { createRefusal } from '@daisy/errors';
setupRitewayBun();

type Ports = Parameters<typeof startRoundMaintenance>[0];
const page = (roundIds: readonly string[]) => ({
  roundIds,
  cycleComplete: true,
});
const ports = (): Ports => ({
  discover: async () => page([]),
  tick: async () => {},
  evaluate: async () => null,
  finalize: async () => {},
  rateUnrated: async () => {},
  timers: { setInterval: () => 1, clearInterval: () => {} },
  now: () => 0,
  failed: (error) => {
    throw error;
  },
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('maintenance immediately discovers all casts and keeps rating recovery separate', async () => {
  const calls: string[] = [];
  let interval: number | undefined;
  const service = startRoundMaintenance({
    discover: async () => page(['human-only', 'missing-session']),
    tick: async (id: string) => {
      calls.push(`tick:${id}`);
    },
    evaluate: async (id: string) => {
      calls.push(`evaluate:${id}`);
      return null;
    },
    finalize: async (id: string) => {
      calls.push(`finalize:${id}`);
    },
    rateUnrated: async () => {
      calls.push('rating-recovery');
    },
    now: () => 0,
    timers: {
      setInterval: (_pulse: () => void, ms: number) => {
        interval = ms;
        return 1;
      },
      clearInterval: () => {},
    },
    failed: () => {
      calls.push('failed');
    },
  });
  await service.ready;
  await service.stop();
  assert({
    given:
      'all-cast active discovery and independent committed-unrated follow-up',
    should:
      'schedule500ms and drive actual tick/evaluate/freeze ports plus rating recovery',
    actual: { interval, calls: calls.sort() },
    expected: {
      interval: 500,
      calls: [
        'tick:human-only',
        'evaluate:human-only',
        'finalize:human-only',
        'tick:missing-session',
        'evaluate:missing-session',
        'finalize:missing-session',
        'rating-recovery',
      ].sort(),
    },
  });
});

test('a held Round does not stop discovery or rating recovery and shutdown drains its work', async () => {
  const held = gate(),
    rediscovered = gate(),
    order: string[] = [];
  let pulse = () => {},
    scans = 0,
    ratings = 0;
  const service = startRoundMaintenance({
    ...ports(),
    discover: async () => {
      scans += 1;
      if (scans === 2) rediscovered.resolve();
      return page(['contended']);
    },
    tick: async () => {
      order.push('tick');
      await held.promise;
    },
    evaluate: async () => {
      order.push('evaluate');
      return null;
    },
    finalize: async () => {
      order.push('finalize');
    },
    rateUnrated: async () => {
      ratings += 1;
    },
    timers: {
      setInterval: (next) => {
        pulse = next;
        return 1;
      },
      clearInterval: () => {},
    },
  });
  await service.ready;
  pulse();
  await rediscovered.promise;
  const closing = service.stop().then(() => {
    order.push('stopped');
  });
  held.resolve();
  await closing;
  assert({
    given: 'one Round remains in flight across another discovery pulse',
    should:
      'avoid duplicate work, preserve both independent scans and drain before pool disposal',
    actual: { scans, ratings, order },
    expected: {
      scans: 2,
      ratings: 2,
      order: ['tick', 'evaluate', 'finalize', 'stopped'],
    },
  });
});

test('terminal attendance races do not freeze and unexpected failures stay observable', async () => {
  const frozen: string[] = [],
    failures: unknown[] = [];
  const finalized = gate(),
    failed = gate();
  const service = startRoundMaintenance({
    ...ports(),
    discover: async () => page(['terminal', 'forfeit', 'pending', 'fault']),
    evaluate: async (id) => {
      if (id === 'terminal')
        throw createRefusal(
          'CONFLICT',
          'attendance-terminal',
          'Reworded sentence',
        );
      if (id === 'fault') throw new Error('actual maintenance failure');
      return id === 'forfeit' ? { decision: 'forfeit' } : null;
    },
    finalize: async (id) => {
      frozen.push(id);
      finalized.resolve();
    },
    failed: (error, stage) => {
      failures.push([error instanceof Error && error.message, stage]);
      failed.resolve();
    },
  });
  await service.ready;
  await Promise.all([finalized.promise, failed.promise]);
  await service.stop();
  assert({
    given:
      'a concurrent terminal result, a committed forfeit, pending attendance and an unrelated error',
    should:
      'finalize every Round still active and report only the unexpected failure with its stage',
    actual: { frozen, failures },
    expected: {
      // A failed evaluation no longer starves the freeze; completion stays gated.
      frozen: ['pending', 'fault'],
      failures: [['actual maintenance failure', 'evaluate']],
    },
  });
});

test('a five-Round fleet leaves capacity for public work and advances queued Rounds fairly', async () => {
  const held = gate(),
    calls: string[] = [];
  let running = 0,
    maximum = 0,
    pulse = () => {};
  const service = startRoundMaintenance({
    ...ports(),
    discover: async () => page(['a', 'b', 'c', 'd', 'e']),
    tick: async (id) => {
      running += 1;
      maximum = Math.max(maximum, running);
      calls.push(id);
      await held.promise;
      running -= 1;
    },
    timers: {
      setInterval: (next) => {
        pulse = next;
        return 1;
      },
      clearInterval: () => {},
    },
  });
  await service.ready;
  assert({
    given:
      'five current active Rounds discovered on the same maintenance pulse',
    should:
      'admit at most two Round pipelines and queue the rest in discovery order',
    actual: { calls: [...calls], maximum },
    expected: { calls: ['a', 'b'], maximum: 2 },
  });
  pulse();
  await service.ready;
  held.resolve();
  // Drain only admitted work; queued work must never start after shutdown.
  await service.stop();
  assert({
    given: 'shutdown with a queued fleet',
    should:
      'drain admitted Rounds without starting queued work or duplicate discoveries',
    actual: { calls, maximum },
    expected: { calls: ['a', 'b'], maximum: 2 },
  });
});

test('one held Round cannot monopolize the bounded fleet queue', async () => {
  const held = gate(),
    advanced = gate(),
    calls: string[] = [];
  let running = 0,
    maximum = 0;
  const service = startRoundMaintenance({
    ...ports(),
    discover: async () => page(['held', 'b', 'c', 'd', 'e']),
    tick: async (id) => {
      running += 1;
      maximum = Math.max(maximum, running);
      calls.push(id);
      if (id === 'held') await held.promise;
      running -= 1;
      if (id === 'e') advanced.resolve();
    },
  });
  try {
    await service.ready;
    await advanced.promise;
    assert({
      given: 'one contended Round and four independent queued candidates',
      should:
        'advance every other candidate fairly through the second lane without filling public capacity',
      actual: { calls, maximum },
      expected: { calls: ['held', 'b', 'c', 'd', 'e'], maximum: 2 },
    });
  } finally {
    held.resolve();
    await service.stop();
  }
});

const flush = async () => {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
};
/** A service whose pulse and clock the test drives. */
function driven(overrides: Partial<Ports>) {
  let pulse: () => Promise<void> = async () => {};
  let clock = 0;
  const service = startRoundMaintenance({
    ...ports(),
    timers: {
      setInterval: (run: () => Promise<void>) => {
        pulse = run;
        return 1;
      },
      clearInterval: () => {},
    },
    now: () => clock,
    ...overrides,
  });
  return {
    service,
    pulse: () => pulse(),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test('a failed evaluation never starves the freeze, and backs off instead of flooding', async () => {
  const frozen: string[] = [];
  const stages: string[] = [];
  let evaluations = 0;
  const { service, pulse, advance } = driven({
    discover: async () => page(['stuck']),
    evaluate: async () => {
      evaluations++;
      throw new Error('evaluator fault');
    },
    finalize: async (id) => {
      frozen.push(id);
    },
    failed: (_error, stage) => stages.push(stage),
  });
  await service.ready;
  await flush();
  for (let n = 0; n < 5; n++) {
    await pulse();
    await flush();
  }
  assert({
    given: 'an evaluator failing on every pulse',
    should: 'report it once, keep finalizing every pulse, and not re-evaluate',
    actual: { evaluations, stages, frozen: frozen.length >= 5 },
    expected: { evaluations: 1, stages: ['evaluate'], frozen: true },
  });
  advance(5_000);
  await pulse();
  await flush();
  advance(5_000);
  await pulse();
  await flush();
  assert({
    given: 'a second failure',
    should: 'wait longer than the first backoff',
    actual: evaluations,
    expected: 2,
  });
  advance(5_000);
  await pulse();
  await flush();
  assert({
    given: 'the doubled wait having passed',
    should: 'try again',
    actual: evaluations,
    expected: 3,
  });
  await service.stop();
});

test('an undecided window is read again only after its wait; a decision moves straight on', async () => {
  const reads: number[] = [];
  let answer: { decision: string } | null = null;
  const { service, pulse, advance } = driven({
    discover: async () => page(['round']),
    evaluate: async () => {
      reads.push(reads.length);
      return answer;
    },
  });
  await service.ready;
  await flush();
  await pulse();
  await flush();
  assert({
    given: 'a null evaluation',
    should: 'not read evidence again on the next pulse',
    actual: reads.length,
    expected: 1,
  });
  advance(5_000);
  answer = { decision: 'attended' };
  await pulse();
  await flush();
  await pulse();
  await flush();
  assert({
    given: 'a resolved window',
    should: 'evaluate the next window on the next pulse',
    actual: reads.length,
    expected: 3,
  });
  await service.stop();
});

test('rounds an uncertain writer holds are measured, not silent', async () => {
  const measures: { rounds: number; oldestMs: number }[] = [];
  const { service, pulse, advance } = driven({
    discover: async () => page(['held']),
    evaluate: async () => ({ decision: 'held' }),
    held: (measure) => measures.push(measure),
  });
  await service.ready;
  await flush();
  advance(60_000);
  await pulse();
  await flush();
  assert({
    given: 'a Round held for a minute',
    should: 'publish how many and how long, and no more often than the period',
    actual: measures,
    expected: [
      { rounds: 1, oldestMs: 0 },
      { rounds: 1, oldestMs: 60_000 },
    ],
  });
  await service.stop();
});

test('ISSUE-819 ISSUE-831: five Rounds across repeated pulses are all served before any runs a third time', async () => {
  const runs: string[] = [];
  const lanes: (() => void)[] = [];
  const { service, pulse } = driven({
    // Discovery order never changes: a queue rebuilt from it would restart at 'a'.
    discover: async () => page(['a', 'b', 'c', 'd', 'e']),
    tick: async (id) => {
      runs.push(id);
      await new Promise<void>((done) => lanes.push(done));
    },
  });
  await service.ready;
  for (let completed = 0; completed < 11; completed++) {
    await flush();
    await pulse();
    await flush();
    lanes.shift()?.();
    await flush();
  }
  const thirdRun = runs.findIndex(
    (id, index) =>
      runs.slice(0, index + 1).filter((r) => r === id).length === 3,
  );
  const beforeThird = new Set(runs.slice(0, thirdRun));
  assert({
    given: 'lanes completing one at a time with discovery on every pulse',
    should: 'serve all five before any Round runs a third time',
    actual: { reachedThird: thirdRun > 0, served: beforeThird.size },
    expected: { reachedThird: true, served: 5 },
  });
  for (const lane of lanes) lane();
  const stopped = service.stop();
  for (let n = 0; n < 8; n++) {
    for (const lane of lanes.splice(0)) lane();
    await flush();
  }
  await stopped;
});

test('a long list is discovered a page at a time and a finished Round leaves the queue', async () => {
  const pages = [
    { roundIds: ['a', 'b', 'c'], cycleComplete: false },
    { roundIds: ['d'], cycleComplete: true },
    { roundIds: ['b', 'c', 'd'], cycleComplete: true },
  ];
  const ran: string[] = [];
  const gates: (() => void)[] = [];
  let scans = 0;
  const { service, pulse } = driven({
    discover: async () => pages[Math.min(scans++, pages.length - 1)]!,
    tick: async (id) => {
      ran.push(id);
      await new Promise<void>((done) => gates.push(done));
    },
  });
  await service.ready;
  await flush();
  await pulse();
  await flush();
  assert({
    given: 'two discovery pages',
    should: 'take one page per pulse',
    actual: scans,
    expected: 2,
  });
  const stopped = service.stop();
  for (let n = 0; n < 8; n++) {
    for (const lane of gates.splice(0)) lane();
    await flush();
  }
  await stopped;
});

test('a failing tick cannot stop a Round reaching its cutoff, and backs off too', async () => {
  const evaluated: string[] = [];
  const stages: string[] = [];
  let ticks = 0;
  const { service, pulse, advance } = driven({
    discover: async () => page(['stuck']),
    tick: async () => {
      ticks++;
      throw new Error('tick fault');
    },
    evaluate: async (id) => {
      evaluated.push(id);
      return null;
    },
    failed: (_error, stage) => stages.push(stage),
  });
  await service.ready;
  await flush();
  assert({
    given: 'a tick that always fails',
    should: 'still evaluate the Round',
    actual: evaluated,
    expected: ['stuck'],
  });
  await pulse();
  await flush();
  advance(1_000);
  await pulse();
  await flush();
  assert({
    given: 'repeated pulses inside the wait',
    should: 'not retry or report the tick again',
    actual: { ticks, stages },
    expected: { ticks: 1, stages: ['tick'] },
  });
  await service.stop();
});

test('a Round in its opening only ticks: its tick backs off, and attendance waits for it to open', async () => {
  const stages: string[] = [];
  let ticks = 0,
    evaluations = 0,
    finalized = 0,
    opening = true;
  const { service, pulse, advance } = driven({
    discover: async () => ({
      ...page(['round']),
      openingIds: opening ? ['round'] : [],
    }),
    tick: async () => {
      ticks++;
      if (opening) throw new Error('tick fault');
    },
    evaluate: async () => {
      evaluations++;
      return null;
    },
    finalize: async () => {
      finalized++;
    },
    failed: (_error, stage) => stages.push(stage),
  });
  await service.ready;
  await flush();
  await pulse();
  await flush();
  advance(1_000);
  await pulse();
  await flush();
  assert({
    given: 'a failing tick on a Round discovery reports as in its opening',
    should:
      'back off the tick and never ask attendance or finalize about the opening',
    actual: { ticks, evaluations, finalized, stages },
    expected: { ticks: 1, evaluations: 0, finalized: 0, stages: ['tick'] },
  });
  opening = false;
  advance(60_000);
  await pulse();
  await flush();
  assert({
    given: 'the next discovery reporting the Round out of its opening',
    should: 'maintain it in full straight away',
    actual: { evaluations, finalized },
    expected: { evaluations: 1, finalized: 1 },
  });
  await service.stop();
});

test('a Round that leaves discovery is forgotten: back again, it waits for nothing', async () => {
  const reads: string[] = [];
  let ids = ['gone', 'kept'];
  const { service, pulse } = driven({
    discover: async () => page(ids),
    evaluate: async (id) => {
      reads.push(id);
      return null;
    },
  });
  await service.ready;
  await flush();
  ids = ['kept'];
  await pulse();
  await flush();
  ids = ['gone', 'kept'];
  await pulse();
  await flush();
  assert({
    given: 'a Round with a null evaluation leaving discovery, then returning',
    should: 'have no retry wait left: its pacing state went with it',
    actual: reads.filter((id) => id === 'gone').length,
    expected: 2,
  });
  await service.stop();
});
