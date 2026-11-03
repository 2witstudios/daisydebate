import { assert, setupRitewayBun, test } from 'riteway/bun';
import { FEED_END_GRACE_MS } from './withdrawal';
import { runWorker } from './worker';

setupRitewayBun();

test('a finished Broadcast is withdrawn, not released again', async () => {
  const deleted: string[] = [];
  const withdrawn: string[] = [];
  const claims: Date[] = [];
  let claimed = 0;
  await runWorker({
    owner: 'w',
    now: () => 120_000,
    sleep: async () => {},
    stopped: () => claimed >= 2,
    report: () => {},
    objects: {
      deletePublic: async (key: string) => {
        deleted.push(key);
      },
    } as never,
    store: {
      claim: async (input: { readonly withdrawFinishedBefore: Date }) => {
        claimed += 1;
        claims.push(input.withdrawFinishedBefore);
        return claimed === 1
          ? {
              id: 'b',
              nextSegment: 1,
              stoppedAt: null,
              finalMediaEndAt: new Date(1),
              completedAt: new Date(2),
            }
          : null;
      },
      recordFeedWithdrawn: async ({ id }: { readonly id: string }) => {
        withdrawn.push(id);
      },
      complete: async () => {
        throw new Error('already complete');
      },
    } as never,
  });
  assert({
    given: 'a claim returning a completed Broadcast past its grace',
    should: 'ask only for those past the grace, delete its feed and record it',
    actual: [
      claims[0],
      deleted[0],
      deleted.includes('live/b/720/seg-0.ts'),
      withdrawn,
    ],
    expected: [
      new Date(120_000 - FEED_END_GRACE_MS),
      'live/b/master.m3u8',
      true,
      ['b'],
    ],
  });
});

test('a database failure does not end the slot', async () => {
  let claims = 0;
  const reports: string[] = [];
  await runWorker({
    owner: 'w',
    now: () => 0,
    sleep: async () => {},
    stopped: () => claims >= 3,
    report: (event) => reports.push(event),
    objects: {} as never,
    store: {
      claim: async () => {
        claims += 1;
        if (claims < 3) throw new Error('database down');
        return null;
      },
    } as never,
  });
  assert({
    given: 'two failed claims and then an idle one',
    should: 'report each and keep going',
    actual: [claims, reports],
    expected: [3, ['broadcast.release_failed', 'broadcast.release_failed']],
  });
});

test('a failed release step keeps the job instead of waiting out its own lease', async () => {
  let claims = 0;
  let reads = 0;
  const reports: string[] = [];
  const recorded: number[] = [];
  await runWorker({
    owner: 'w',
    now: () => 900_000,
    sleep: async () => {},
    stopped: () => recorded.length >= 1,
    report: (event: string) => {
      reports.push(event);
    },
    objects: {
      putManifest: async () => {},
      readHoldText: async () => {
        reads += 1;
        if (reads === 1) throw new Error('transient');
        return '';
      },
    } as never,
    store: {
      claim: async () => {
        claims += 1;
        return {
          id: 'b',
          nextSegment: 0,
          holdCursor: 0,
          releasedGeneration: 1,
          egressGeneration: 1,
          egressStartedAt: new Date(0),
          leaseEpoch: 1,
          stoppedAt: null,
          completedAt: null,
          streamEndedAt: null,
          finalMediaEndAt: new Date(0),
          releasePolicy: { kind: 'delay', seconds: 60 },
        };
      },
      recordEnded: async () => {
        recorded.push(1);
        return true;
      },
    } as never,
  });
  assert({
    given: 'a hold read that fails once, on a job this worker holds',
    should: 'report it, retry the same job and finish it with one claim',
    actual: [claims, reports, recorded],
    expected: [1, ['broadcast.release_failed'], [1]],
  });
});
