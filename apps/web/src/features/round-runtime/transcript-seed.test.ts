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

test('a denial or a changed contract stops asking', async () => {
  const denied = asking([{ kind: 'missing' }]);
  await denied.fire();
  const outdated = asking([{ kind: 'unavailable', outdated: true }]);
  await outdated.fire();
  assert({
    given: 'an answer that asking again cannot change',
    should: 'settle it and schedule nothing more',
    actual: [
      denied.settled,
      denied.waiting(),
      outdated.settled,
      outdated.waiting(),
    ],
    expected: [[{ kind: 'denied' }], false, [{ kind: 'outdated' }], false],
  });
});

test('leaving the page ends the asking', async () => {
  const stopped = asking([{ kind: 'unavailable' }]);
  stopped.stop();
  assert({
    given: 'a stop before the wait ends',
    should: 'cancel the wait',
    actual: stopped.waiting(),
    expected: false,
  });
});
