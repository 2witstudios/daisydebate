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
        controlHeartbeatAt: new Date(800_000),
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
        controlHeartbeatAt: new Date(1000),
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
