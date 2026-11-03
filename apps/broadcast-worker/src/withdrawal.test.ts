import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { withdrawalKeys, withdrawFeed } from './withdrawal';

setupRitewayBun();

const run = async (
  finalMediaEndAt: Date | null,
  completedAt: Date | null = null,
) => {
  const log: string[] = [];
  await withdrawFeed(
    { feedKey: 'b', nextSegment: 1, finalMediaEndAt, completedAt },
    {
      recordWithdrawn: async () => {
        log.push('withdrawn');
      },
      deletePublic: async (key) => {
        log.push(key);
      },
      complete: async () => {
        log.push('complete');
      },
    },
  );
  return log;
};

describe('Withdrawing a finished Broadcast', () => {
  test('manifests go first, then every segment including the cursor’s', () => {
    const keys = withdrawalKeys('b', 1);
    assert({
      given: 'one released segment',
      should: 'name the manifests first and both possible segments',
      actual: [
        keys.slice(0, 4),
        keys.includes('live/b/720/seg-0.ts'),
        keys.includes('live/b/240/seg-1.ts'),
        keys.some((key) => key.startsWith('hold/')),
      ],
      expected: [
        [
          'live/b/master.m3u8',
          'live/b/720/index.m3u8',
          'live/b/480/index.m3u8',
          'live/b/240/index.m3u8',
        ],
        true,
        true,
        false,
      ],
    });
  });

  test('it completes only once the Egress is known to be gone', async () => {
    const waiting = await run(null);
    const done = await run(new Date(1));
    assert({
      given: 'no recorded end, then a recorded one',
      should: 'withdraw both times and complete only the second, last',
      actual: [waiting.includes('complete'), done.at(-1), waiting.length > 0],
      expected: [false, 'complete', true],
    });
  });

  test('a completed Broadcast records the withdrawal and completes no more', async () => {
    const log = await run(new Date(1), new Date(2));
    assert({
      given: 'a Broadcast already complete past its grace',
      should: 'delete every key before recording it, and not complete it again',
      actual: [log[0], log.at(-1), log.includes('complete')],
      expected: ['live/b/master.m3u8', 'withdrawn', false],
    });
  });
});
