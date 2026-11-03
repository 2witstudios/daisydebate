import { CONTENT_MODERATION_DELIVERY_BOUND_MS } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  FEED_END_GRACE_MS,
  runFeedWithdrawals,
  withdrawalKeys,
  withdrawFeed,
} from './withdrawal';

setupRitewayBun();

const NOW = Date.parse('2026-11-03T12:00:00.000Z');
const LONG_AGO = new Date(NOW - 3_600_000);
const run = async (
  finalMediaEndAt: Date | null,
  completedAt: Date | null = null,
  hold: { readonly recording?: boolean; readonly pages?: number } = {},
) => {
  const log: string[] = [];
  let pages = hold.pages ?? 2;
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
      recordingKeepsHold: async () => hold.recording ?? true,
      discardHoldPage: async () => {
        pages -= 1;
        log.push('discard');
        return Math.max(0, pages);
      },
      nowMs: () => NOW,
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

describe('Deleting a long feed', () => {
  test('every manifest goes before any segment, a bounded batch at a time', async () => {
    let inFlight = 0;
    let most = 0;
    const order: string[] = [];
    await withdrawFeed(
      {
        feedKey: 'b',
        nextSegment: 99,
        finalMediaEndAt: null,
        completedAt: null,
      },
      {
        deletePublic: async (key) => {
          order.push(key);
          inFlight += 1;
          most = Math.max(most, inFlight);
          await Promise.resolve();
          inFlight -= 1;
        },
        recordWithdrawn: async () => {},
        complete: async () => {},
      },
    );
    assert({
      given: 'a hundred segments in three renditions',
      should: 'delete manifests first and run batches, not one at a time',
      actual: [
        order.slice(0, 4).every((key) => key.endsWith('.m3u8')),
        order.length,
        most,
      ],
      expected: [true, 304, 32],
    });
  });
});

describe('The withdrawal loop', () => {
  test('a stopped feed of a two-hour Round is gone within the delivery bound', async () => {
    const SEGMENTS_IN_TWO_HOURS = 3600;
    const DELETE_LATENCY_MS = 50;
    let nowMs = 0;
    let deletedAtMs = -1;
    let polls = 0;
    await runFeedWithdrawals({
      owner: 'w',
      now: () => nowMs,
      sleep: async (ms) => {
        nowMs += ms;
      },
      stopped: () => polls >= 3,
      report: () => {},
      objects: {
        deletePublic: async () => {
          nowMs += DELETE_LATENCY_MS / 32;
          deletedAtMs = nowMs;
        },
      } as never,
      store: {
        // Stopped as this loop went idle: it meets the stop on its next poll.
        claimWithdrawal: async () => {
          polls += 1;
          return polls === 2
            ? {
                id: 'b',
                feedKey: 'b',
                nextSegment: SEGMENTS_IN_TWO_HOURS,
                finalMediaEndAt: null,
                completedAt: null,
              }
            : null;
        },
        recordFeedWithdrawn: async () => {},
      } as never,
    });
    assert({
      given: 'a stop, one idle poll away, with hours of segments to delete',
      should: 'have deleted the last public object inside the bound',
      actual:
        deletedAtMs > 0 && deletedAtMs <= CONTENT_MODERATION_DELIVERY_BOUND_MS,
      expected: true,
    });
  });

  const edges = { now: () => 120_000, sleep: async () => {} };

  test('takes down a claimed feed without a release slot', async () => {
    const deleted: string[] = [];
    const withdrawn: string[] = [];
    const claims: Date[] = [];
    let polls = 0;
    await runFeedWithdrawals({
      ...edges,
      owner: 'w',
      stopped: () => polls >= 2,
      report: () => {},
      objects: {
        deletePublic: async (key: string) => {
          deleted.push(key);
        },
      } as never,
      store: {
        claimWithdrawal: async (input: {
          readonly withdrawFinishedBefore: Date;
        }) => {
          polls += 1;
          claims.push(input.withdrawFinishedBefore);
          return polls === 1
            ? {
                id: 'b',
                feedKey: 'b',
                nextSegment: 1,
                finalMediaEndAt: new Date(1),
                completedAt: new Date(2),
              }
            : null;
        },
        recordFeedWithdrawn: async ({ id }: { readonly id: string }) => {
          withdrawn.push(id);
        },
      } as never,
    });
    assert({
      given: 'a claim returning a finished Broadcast',
      should: 'ask only for those past the grace, delete it and record it',
      actual: [claims[0], deleted[0], withdrawn],
      expected: [
        new Date(120_000 - FEED_END_GRACE_MS),
        'live/b/master.m3u8',
        ['b'],
      ],
    });
  });

  test('a failed delete does not end the loop', async () => {
    const reports: string[] = [];
    let polls = 0;
    await runFeedWithdrawals({
      ...edges,
      owner: 'w',
      stopped: () => polls >= 2,
      report: (event) => reports.push(event),
      objects: {
        deletePublic: async () => {
          throw new Error('storage down');
        },
      } as never,
      store: {
        claimWithdrawal: async () => {
          polls += 1;
          return polls === 1
            ? {
                id: 'b',
                feedKey: 'b',
                nextSegment: 0,
                finalMediaEndAt: null,
                completedAt: null,
              }
            : null;
        },
      } as never,
    });
    assert({
      given: 'a delete that fails, then another poll',
      should: 'report it and keep polling',
      actual: [polls, reports],
      expected: [2, ['broadcast.withdrawal_failed']],
    });
  });

  test('a hold no Recording will read goes with the feed, and one it will read stays', async () => {
    const tail = async (recording: boolean) =>
      (await run(LONG_AGO, LONG_AGO, { recording })).slice(-3);
    assert({
      given: 'a finished Broadcast with no Recording, then one with',
      should: 'empty the hold before recording it withdrawn, or leave it',
      actual: [await tail(false), await tail(true)],
      expected: [
        ['discard', 'discard', 'withdrawn'],
        ['live/b/480/seg-1.ts', 'live/b/240/seg-1.ts', 'withdrawn'],
      ],
    });
  });
  test('a stop too recent leaves the hold, and does not complete yet', async () => {
    const log = await run(new Date(NOW - 1000), null, { recording: false });
    assert({
      given: 'a stop whose Egress may still be writing',
      should: 'withdraw the feed, and neither discard nor complete',
      actual: [log.includes('discard'), log.includes('complete'), log.at(-1)],
      expected: [false, false, 'withdrawn'],
    });
  });
});
