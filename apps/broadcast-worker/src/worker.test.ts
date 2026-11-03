import { assert, setupRitewayBun, test } from 'riteway/bun';
import { runWorker } from './worker';

setupRitewayBun();

const noScratch = { dir: () => '/nowhere', clear: async () => {} };

test('a database failure does not end the slot', async () => {
  let claims = 0;
  const reports: string[] = [];
  await runWorker({
    owner: 'w',
    now: () => 0,
    sleep: async () => {},
    stopped: () => claims >= 3,
    report: (event) => reports.push(event),
    scratch: noScratch,
    objects: {} as never,
    store: {
      recordPassed: async () => true,
      readStageHistory: async () => ({
        segments: [{ startedAtMs: 0, endedAtMs: 900_000, durationMs: 900_000 }],
        privateSpans: [],
      }),
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
    scratch: noScratch,
    objects: {
      putManifest: async () => {},
      ensureDir: async () => {},
      holdExists: async () => true,
      readHoldText: async () => {
        reads += 1;
        if (reads === 1) throw new Error('transient');
        return '';
      },
    } as never,
    store: {
      recordPassed: async () => true,
      readStageHistory: async () => ({
        segments: [{ startedAtMs: 0, endedAtMs: 900_000, durationMs: 900_000 }],
        privateSpans: [],
      }),
      claim: async () => {
        claims += 1;
        return {
          id: 'b',
          releaseSkips: { clips: [] },
          nextSegment: 0,
          holdCursor: 0,
          releasedGeneration: 1,
          egressGeneration: 1,
          egressStartedAt: new Date(0),
          leaseEpoch: 1,
          stoppedAt: null,
          completedAt: null,
          streamEndedAt: null,
          controlHeartbeatAt: new Date(800_000),
          createdAt: new Date(0),
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

test('what a step put on disk goes with the step, whatever became of it', async () => {
  const cleared: string[] = [];
  const reports: string[] = [];
  let steps = 0;
  await runWorker({
    owner: 'w',
    now: () => 900_000,
    sleep: async () => {},
    stopped: () => steps >= 1,
    report: (event: string) => {
      reports.push(event);
    },
    scratch: {
      dir: (id) => `/scratch/${id}`,
      clear: async (id) => {
        cleared.push(id);
      },
    },
    objects: {
      putManifest: async () => {},
      ensureDir: async () => {},
      holdExists: async () => true,
      readHoldText: async () =>
        '#EXTM3U\n#EXT-X-PROGRAM-DATE-TIME:1970-01-01T00:00:00.000Z\n#EXTINF:4.0,\ns_0.ts\n',
      copyHoldToFile: async (_key: string, path: string) => {
        steps += 1;
        throw new Error(`no room for ${path}`);
      },
    } as never,
    store: {
      recordPassed: async () => true,
      readStageHistory: async () => ({
        segments: [{ startedAtMs: 0, endedAtMs: 900_000, durationMs: 900_000 }],
        privateSpans: [],
      }),
      claim: async () => ({
        id: 'b',
        nextSegment: 0,
        holdCursor: 0,
        releasedGeneration: 1,
        egressGeneration: 1,
        egressStartedAt: new Date(0),
        leaseEpoch: 1,
        feedKey: 'k',
        releaseSkips: { clips: [] },
        controlHeartbeatAt: new Date(800_000),
        createdAt: new Date(0),
        stoppedAt: null,
        completedAt: null,
        streamEndedAt: null,
        finalMediaEndAt: null,
        releasePolicy: { kind: 'delay', seconds: 60 },
      }),
    } as never,
  });
  assert({
    given: 'a step that fails after it began encoding',
    should: 'report it, and clear the disk on claim and after the step',
    actual: [cleared, reports],
    expected: [['b', 'b'], ['broadcast.release_failed']],
  });
});

test('media past the last heartbeat is said once, and the slot stays with the job', async () => {
  let reads = 0;
  const reports: string[] = [];
  await runWorker({
    owner: 'w',
    now: () => 900_000,
    sleep: async () => {},
    stopped: () => reads >= 3,
    report: (event: string) => {
      reports.push(event);
    },
    scratch: noScratch,
    objects: {
      putManifest: async () => {},
      ensureDir: async () => {},
      holdExists: async () => true,
      readHoldText: async () => {
        reads += 1;
        return '#EXTM3U\n#EXT-X-PROGRAM-DATE-TIME:1970-01-01T00:00:00.000Z\n#EXTINF:4.0,\ns_0.ts\n';
      },
    } as never,
    store: {
      recordPassed: async () => true,
      readStageHistory: async () => ({
        segments: [{ startedAtMs: 0, endedAtMs: 900_000, durationMs: 900_000 }],
        privateSpans: [],
      }),
      claim: async () => ({
        id: 'b',
        nextSegment: 0,
        holdCursor: 0,
        releasedGeneration: 1,
        egressGeneration: 1,
        egressStartedAt: new Date(0),
        leaseEpoch: 1,
        feedKey: 'k',
        releaseSkips: { clips: [] },
        controlHeartbeatAt: new Date(1000),
        createdAt: new Date(0),
        stoppedAt: null,
        completedAt: null,
        streamEndedAt: null,
        finalMediaEndAt: null,
        releasePolicy: { kind: 'delay', seconds: 60 },
      }),
    } as never,
  });
  assert({
    given: 'three passes over a due segment past a stale heartbeat',
    should: 'report it once and release nothing',
    actual: reports,
    expected: ['broadcast.release_lapsed'],
  });
});

const dueFromWorker = (clips: readonly number[]) => ({
  id: 'b',
  releaseSkips: { clips },
  nextSegment: 0,
  holdCursor: 0,
  releasedGeneration: 1,
  egressGeneration: 1,
  egressStartedAt: new Date(0),
  leaseEpoch: 1,
  feedKey: 'k',
  controlHeartbeatAt: new Date(800_000),
  createdAt: new Date(0),
  stoppedAt: null,
  completedAt: null,
  streamEndedAt: null,
  finalMediaEndAt: null,
  releasePolicy: { kind: 'delay', seconds: 60 },
});

test('a segment that is missing is given up on after five tries, and said out loud', async () => {
  const reports: string[] = [];
  const recorded: number[] = [];
  const waits: number[] = [];
  let steps = 0;
  await runWorker({
    owner: 'w',
    now: () => 900_000,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
    stopped: () => recorded.length >= 1 || steps > 20,
    report: (event: string) => {
      reports.push(event);
    },
    scratch: noScratch,
    objects: {
      putManifest: async () => {},
      ensureDir: async () => {},
      holdExists: async () => {
        steps += 1;
        return false;
      },
      readHoldText: async () =>
        '#EXTM3U\n#EXT-X-PROGRAM-DATE-TIME:1970-01-01T00:00:00.000Z\n#EXTINF:4.0,\ns_0.ts\n',
    } as never,
    store: {
      recordPassed: async () => true,
      readStageHistory: async () => ({
        segments: [{ startedAtMs: 0, endedAtMs: 900_000, durationMs: 900_000 }],
        privateSpans: [],
      }),
      recordSkipped: async ({ capturedAtMs }: { capturedAtMs: number }) => {
        recorded.push(capturedAtMs);
        return true;
      },
      claim: async () => dueFromWorker([]),
    } as never,
  });
  assert({
    given: 'a held segment that is gone',
    should:
      'try five times with a growing wait, then record the gap and report it',
    actual: [
      steps,
      recorded.length,
      reports.filter((event) => event === 'broadcast.clip_skipped').length,
      waits.filter((ms) => ms >= 1000 && ms !== 5000),
    ],
    expected: [5, 1, 1, [1000, 2000, 4000, 8000]],
  });
});

test('a storage outage is retried for as long as it lasts, and nothing is given up', async () => {
  const recorded: number[] = [];
  let steps = 0;
  await runWorker({
    owner: 'w',
    now: () => 900_000,
    sleep: async () => {},
    stopped: () => steps >= 8,
    report: () => {},
    scratch: noScratch,
    objects: {
      putManifest: async () => {},
      ensureDir: async () => {},
      holdExists: async () => {
        steps += 1;
        throw new Error('storage down');
      },
      readHoldText: async () =>
        '#EXTM3U\n#EXT-X-PROGRAM-DATE-TIME:1970-01-01T00:00:00.000Z\n#EXTINF:4.0,\ns_0.ts\n',
    } as never,
    store: {
      recordPassed: async () => true,
      readStageHistory: async () => ({
        segments: [{ startedAtMs: 0, endedAtMs: 900_000, durationMs: 900_000 }],
        privateSpans: [],
      }),
      recordSkipped: async ({ capturedAtMs }: { capturedAtMs: number }) => {
        recorded.push(capturedAtMs);
        return true;
      },
      claim: async () => dueFromWorker([]),
    } as never,
  });
  assert({
    given: 'hold reads failing eight times',
    should: 'skip nothing',
    actual: recorded,
    expected: [],
  });
});

test('a stop seen mid-step withdraws, and nothing more is published', async () => {
  const published: string[] = [];
  let now = 900_000;
  let withdrawn = false;
  await runWorker({
    owner: 'w',
    now: () => now,
    sleep: async () => {
      now += 6000;
    },
    stopped: () => withdrawn,
    report: () => {},
    scratch: noScratch,
    objects: {
      putManifest: async (key: string) => {
        published.push(key);
      },
      ensureDir: async () => {},
      holdExists: async () => true,
      readHoldText: async () => '',
      deletePublic: async () => {},
      discardHoldPage: async () => 0,
    } as never,
    store: {
      recordPassed: async () => true,
      readStageHistory: async () => ({ segments: [], privateSpans: [] }),
      renew: async () => ({
        ...dueFromWorker([]),
        stoppedAt: new Date(900_000),
      }),
      recordFeedWithdrawn: async () => {
        withdrawn = true;
      },
      recordingKeepsHold: async () => true,
      claim: async () => dueFromWorker([]),
    } as never,
  });
  assert({
    given: 'a renewal finding the Broadcast stopped',
    should: 'withdraw, with only the master written before it',
    actual: [withdrawn, published],
    expected: [true, ['live/k/master.m3u8']],
  });
});

test('a long delay gives the slot back, until something is due', async () => {
  const parked: number[] = [];
  let claims = 0;
  await runWorker({
    owner: 'w',
    now: () => 900_000,
    sleep: async () => {},
    stopped: () => claims >= 2,
    report: () => {},
    scratch: noScratch,
    objects: {
      putManifest: async () => {},
      readHoldText: async () => '',
    } as never,
    store: {
      recordPassed: async () => true,
      readStageHistory: async () => ({ segments: [], privateSpans: [] }),
      park: async ({ until }: { until: Date }) => {
        parked.push(until.getTime());
        return true;
      },
      claim: async () => {
        claims += 1;
        return claims === 1
          ? {
              ...dueFromWorker([]),
              releasePolicy: { kind: 'delay', seconds: 86_400 },
            }
          : null;
      },
    } as never,
  });
  assert({
    given: 'a host’s day-long delay with nothing held',
    should: 'park until about a day on, and go on to the next claim',
    actual: [parked, claims],
    expected: [[900_000 + 86_400_000 - 10_000], 2],
  });
});
