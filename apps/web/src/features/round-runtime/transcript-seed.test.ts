import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { LiveTranscriptRead } from '@daisy/protocol';
import type { ResourceRead } from '../resource-sync/driver';
import { askForTranscriptSeed, type TranscriptSeed } from './transcript-seed';

setupRitewayBun();

const seed = { round: { id: 'r' } } as unknown as LiveTranscriptRead;

const asking = (answers: ResourceRead<LiveTranscriptRead>[]) => {
  const settled: TranscriptSeed[] = [];
  let pending: (() => void) | null = null;
  let reads = 0;
  const stop = askForTranscriptSeed({
    read: async () => {
      reads++;
      return answers.shift()!;
    },
    schedule: (attempt) => {
      pending = attempt;
      return () => {
        pending = null;
      };
    },
    settled: (value) => settled.push(value),
  });
  const fire = async () => {
    const attempt = pending;
    pending = null;
    attempt?.();
    await Promise.resolve();
    await Promise.resolve();
  };
  return {
    fire,
    stop,
    settled,
    reads: () => reads,
    waiting: () => pending !== null,
  };
};

test('an outage asks again until the seed arrives', async () => {
  const world = asking([
    { kind: 'unavailable' },
    { kind: 'unavailable' },
    { kind: 'found', value: seed },
  ]);
  const beforeAnyWait = world.reads();
  await world.fire();
  await world.fire();
  const whileRefused = world.settled.length;
  await world.fire();
  assert({
    given: 'two refusals and then an answer',
    should: 'wait before the first read, then settle only on the answer',
    actual: [beforeAnyWait, whileRefused, world.settled, world.waiting()],
    expected: [0, 0, [{ kind: 'found', seed }], false],
  });
});

test('a denial stops asking; a changed contract reports and keeps asking', async () => {
  const denied = asking([{ kind: 'missing' }]);
  await denied.fire();
  const outdated = asking([
    { kind: 'unavailable', outdated: true },
    { kind: 'found', value: seed },
  ]);
  await outdated.fire();
  const whileOutdated = [outdated.settled.at(-1), outdated.waiting()];
  await outdated.fire();
  assert({
    given: 'a denial, and an outdated answer followed by a readable one',
    should: 'end on the denial and recover from the outdated answer',
    actual: [
      denied.settled,
      denied.waiting(),
      whileOutdated,
      outdated.settled.at(-1),
    ],
    expected: [
      [{ kind: 'denied' }],
      false,
      [{ kind: 'outdated' }, true],
      { kind: 'found', seed },
    ],
  });
});

test('a thrown read asks again', async () => {
  const settled: TranscriptSeed[] = [];
  let pending: (() => void) | null = null;
  askForTranscriptSeed({
    read: () => Promise.reject(new Error('no timeout API')),
    schedule: (attempt) => {
      pending = attempt;
      return () => {};
    },
    settled: (value) => settled.push(value),
  });
  const first = pending!;
  pending = null;
  (first as () => void)();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert({
    given: 'a read that rejects',
    should: 'settle nothing and schedule another',
    actual: [settled, pending !== null],
    expected: [[], true],
  });
});

test('leaving the page ends the asking', async () => {
  const stopped = asking([{ kind: 'unavailable' }]);
  stopped.stop();
  const inFlight = asking([{ kind: 'found', value: seed }]);
  const answering = inFlight.fire();
  inFlight.stop();
  await answering;
  assert({
    given: 'a stop during the wait, and one during a read',
    should: 'cancel the wait and ignore the answer',
    actual: [stopped.waiting(), inFlight.settled],
    expected: [false, []],
  });
});
