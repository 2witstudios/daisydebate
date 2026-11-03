import type { RecordingJobState } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { RecordingVerificationError } from './build-recording';
import {
  afterBuildFailure,
  progressIsNews,
  retryDelayMs,
  runWorker,
} from './worker';

setupRitewayBun();

const NOW = 1_000_000;
const built: RecordingJobState = {
  status: 'failed',
  reason: 'no_media',
  failedAt: '2026-11-03T00:00:00.000Z',
};
const queued = {
  recordingId: 'r',
  holdPrefix: 'hold/b/',
  status: 'queued' as const,
  state: { status: 'queued' as const, attemptCount: 2 },
  runsStarted: 1,
  leaseEpoch: 7,
};

/** Runs one claimed job to the end, recording what the worker asked of the store. */
const runOne = async (
  job: typeof queued | Record<string, unknown>,
  over: {
    readonly build?: () => Promise<RecordingJobState>;
    readonly renew?: () => Promise<boolean>;
    readonly discardPage?: (prefix: string) => Promise<number>;
    readonly now?: () => number;
  } = {},
) => {
  const calls = {
    finished: [] as unknown[],
    deferred: [] as unknown[],
    reported: [] as string[],
    removed: [] as string[],
    builds: [] as unknown[],
    aborted: [] as boolean[],
  };
  const signals: AbortSignal[] = [];
  let claimed = 0;
  await runWorker({
    owner: 'w',
    now: over.now ?? (() => NOW),
    sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
    stopped: () => claimed >= 2,
    report: (event) => calls.reported.push(event),
    workDirOf: (id, owner) => `/work/${id}-${owner}`,
    removeWorkDir: async (path) => {
      calls.removed.push(path);
    },
    strip: async () => {},
    discardPage: over.discardPage ?? (async () => 0),
    build: async (input, run) => {
      calls.builds.push(input);
      signals.push(run.signal);
      return (over.build ?? (async () => built))();
    },
    store: {
      recordProgress: async () => {},
      claim: async () => {
        claimed += 1;
        return claimed === 1 ? job : null;
      },
      renew: over.renew ?? (async () => true),
      finish: async (input: unknown) => {
        calls.finished.push(input);
        return true;
      },
      defer: async (input: unknown) => {
        calls.deferred.push(input);
        return 1;
      },
    } as never,
  });
  calls.aborted.push(...signals.map((signal) => signal.aborted));
  return calls;
};

describe('a claimed build', () => {
  test('writes its result under its fence, and clears its work', async () => {
    const calls = await runOne(queued);
    assert({
      given: 'a build that answers',
      should:
        'pass the attempts on and finish fenced by owner, epoch and state',
      actual: [calls.builds, calls.finished, calls.removed],
      expected: [
        [{ recordingId: 'r', holdPrefix: 'hold/b/', attemptCount: 2 }],
        [
          {
            recordingId: 'r',
            owner: 'w',
            epoch: 7,
            expected: 'queued',
            state: built,
          },
        ],
        ['/work/r-w'],
      ],
    });
  });

  test('a failure comes due again, later each time', async () => {
    const calls = await runOne(queued, {
      build: async () => {
        throw new Error('vendor outage');
      },
    });
    assert({
      given: 'a build that throws',
      should: 'report without detail, finish nothing, and retry after a minute',
      actual: [calls.reported, calls.finished, calls.deferred],
      expected: [
        ['recording.processing_failed'],
        [],
        [
          {
            recordingId: 'r',
            owner: 'w',
            epoch: 7,
            retryAt: new Date(NOW + 60_000),
            failed: true,
          },
        ],
      ],
    });
    assert({
      given: 'more failures',
      should: 'double up to an hour',
      actual: [retryDelayMs(1), retryDelayMs(2), retryDelayMs(30)],
      expected: [60_000, 120_000, 3_600_000],
    });
  });

  test('the last failure is said out loud, never retried forever', async () => {
    const calls = await runOne(
      { ...queued, runsStarted: 5 },
      {
        build: async () => {
          throw new RecordingVerificationError('object_mismatch');
        },
      },
    );
    assert({
      given: 'the fifth failed run, on verification',
      should: 'finish as verification_failed',
      actual: [
        (calls.finished[0] as { state: { reason: string } }).state.reason,
        calls.reported,
        calls.deferred,
      ],
      expected: [
        'verification_failed',
        ['recording.processing_failed', 'recording.processing_gave_up'],
        [],
      ],
    });
    assert({
      given: 'a failure that is not verification',
      should: 'be a processing failure',
      actual: afterBuildFailure(5, new Error('x'), 'at')?.reason,
      expected: 'processing_failed',
    });
    assert({
      given: 'a failure with attempts left',
      should: 'not give up',
      actual: afterBuildFailure(4, new Error('x'), 'at'),
      expected: null,
    });
  });
});

describe('a run that died with its process', () => {
  test('has counted, so the one after its last attempt reports failed and builds nothing', async () => {
    const calls = await runOne({ ...queued, runsStarted: 6 });
    assert({
      given: 'five runs started that never answered, claimed again',
      should: 'finish as failed with the operator alert, and not build',
      actual: [
        calls.builds,
        (calls.finished[0] as { state: { status: string; reason: string } })
          .state,
        calls.reported,
      ],
      expected: [
        [],
        {
          status: 'failed',
          reason: 'processing_failed',
          failedAt: new Date(NOW).toISOString(),
        },
        ['recording.processing_gave_up'],
      ],
    });
  });

  test('still gets its last attempt', async () => {
    const calls = await runOne({ ...queued, runsStarted: 5 });
    assert({
      given: 'the fifth run claimed',
      should: 'build',
      actual: calls.builds.length,
      expected: 1,
    });
  });

  test('a discard has no last attempt, however many runs died', async () => {
    const calls = await runOne({
      ...queued,
      status: 'discarding',
      state: { status: 'discarding' },
      runsStarted: 40,
    });
    assert({
      given: 'a discard claimed after many deaths',
      should: 'carry on and settle',
      actual: (calls.finished[0] as { state: { status: string } }).state.status,
      expected: 'settled',
    });
  });

  test('the claim is told when this run comes due if it dies', async () => {
    const asked: { retryAtOf: (runs: number) => Date }[] = [];
    let claims = 0;
    await runWorker({
      owner: 'w',
      now: () => NOW,
      sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
      stopped: () => claims >= 1,
      report: () => {},
      workDirOf: () => '/work',
      removeWorkDir: async () => {},
      strip: async () => {},
      discardPage: async () => 0,
      build: async () => built,
      store: {
        claim: async (input: { retryAtOf: (runs: number) => Date }) => {
          claims += 1;
          asked.push(input);
          return null;
        },
      } as never,
    });
    assert({
      given: 'a first and a third run',
      should: 'back off as a failed run does',
      actual: [1, 3].map((runs) => asked[0]?.retryAtOf(runs).getTime()),
      expected: [NOW + retryDelayMs(1), NOW + retryDelayMs(3)],
    });
  });
});

describe('a claimed discard', () => {
  const discarding = {
    recordingId: 'r',
    holdPrefix: 'hold/b/',
    status: 'discarding',
    state: { status: 'discarding' },
    runsStarted: 1,
    leaseEpoch: 1,
  };
  test('settles only when the prefix lists empty', async () => {
    const pages = [1000, 3, 0];
    const asked: string[] = [];
    const calls = await runOne(discarding, {
      discardPage: async (prefix) => {
        asked.push(prefix);
        return pages.shift() ?? 0;
      },
    });
    assert({
      given: 'three pages, the last empty',
      should: 'keep deleting, then settle fenced',
      actual: [
        asked.length,
        (calls.finished[0] as { state: { status: string } }).state.status,
      ],
      expected: [3, 'settled'],
    });
  });
  test('a storage failure retries and never claims it settled', async () => {
    const calls = await runOne(discarding, {
      discardPage: async () => {
        throw new Error('outage');
      },
    });
    assert({
      given: 'a delete that fails',
      should: 'defer and report, keeping the intent',
      actual: [calls.finished, calls.deferred.length, calls.reported],
      expected: [[], 1, ['recording.source_discard_failed']],
    });
  });
});

describe('a job taken away mid-build', () => {
  test('aborts the work and counts no failure', async () => {
    const calls = await runOne(queued, {
      renew: async () => false,
      build: () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('aborted')), 20),
        ),
    });
    assert({
      given: 'a renewal refused because the web moved the job to discarding',
      should: 'stop with no report, no result and no backoff',
      actual: [
        calls.aborted,
        calls.finished,
        calls.reported,
        (calls.deferred[0] as { failed: boolean }).failed,
      ],
      expected: [[true], [], [], false],
    });
  });
});

describe('progressIsNews', () => {
  test('writes a new step at once, and a step in progress only now and then', () => {
    const last = { step: 'encoding', atMs: 1000 };
    assert({
      given:
        'nothing written, a new step, a moment later, and five seconds later',
      should: 'write, write, skip, write',
      actual: [
        progressIsNews(null, 'encoding', 0),
        progressIsNews(last, 'uploading', 1001),
        progressIsNews(last, 'encoding', 1001),
        progressIsNews(last, 'encoding', 6000),
      ],
      expected: [true, true, false, true],
    });
  });
});

describe('a run past its ceiling', () => {
  const slow = (runsStarted: number) => ({
    ...queued,
    runsStarted,
    state: { ...queued.state, ceilingMs: 1000 },
  });
  let clock = NOW;
  const ticking = () => {
    clock += 400;
    return clock;
  };
  const forever = () => new Promise<RecordingJobState>(() => {});

  test('is stopped, counted as a failed attempt, retried and alerted', async () => {
    const calls = await runOne(slow(1), { build: forever, now: ticking });
    assert({
      given: 'a build that never returns, past its ceiling',
      should: 'alert, fail the attempt with a retry, and discard nothing',
      actual: [
        calls.reported,
        calls.deferred.length,
        (calls.deferred[0] as { failed: boolean }).failed,
        calls.finished,
      ],
      expected: [
        ['recording.build_ceiling_exceeded', 'recording.processing_failed'],
        1,
        true,
        [],
      ],
    });
  });

  test('on the last attempt ends as failed, with its alert', async () => {
    const calls = await runOne(slow(5), { build: forever, now: ticking });
    assert({
      given: 'the same on its fifth failed run',
      should: 'report failed and give up, which the alert names',
      actual: [
        calls.reported.includes('recording.processing_gave_up'),
        (calls.finished[0] as { state: { status: string } }).state.status,
      ],
      expected: [true, 'failed'],
    });
  });

  test('a run within its ceiling is left alone', async () => {
    const calls = await runOne(slow(1), { now: () => NOW });
    assert({
      given: 'a build that finishes inside it',
      should: 'alert nothing',
      actual: calls.reported,
      expected: [],
    });
  });
});

test('a failed Recording is stripped by what history proved, and says it is done', async () => {
  const stripped: unknown[] = [];
  const finished: unknown[] = [];
  let claims = 0;
  const intervals = [{ fromMs: 1, toMs: 2 }];
  await runWorker({
    owner: 'w',
    now: () => 1000,
    sleep: async () => {},
    stopped: () => claims >= 2,
    report: () => {},
    build: async () => {
      throw new Error('never');
    },
    discardPage: async () => 0,
    strip: async (prefix: string, kept: unknown) => {
      stripped.push([prefix, kept]);
    },
    workDirOf: () => '/w',
    removeWorkDir: async () => {},
    store: {
      claim: async () => {
        claims += 1;
        return claims === 1
          ? {
              recordingId: 'r',
              holdPrefix: 'hold/b/',
              status: 'stripping',
              leaseEpoch: 1,
              failures: 0,
              state: { status: 'stripping', publicIntervals: intervals },
            }
          : null;
      },
      finish: async (input: { state: unknown }) => {
        finished.push((input.state as { status: string }).status);
        return true;
      },
      defer: async () => null,
      renew: async () => true,
    } as never,
  } as never);
  assert({
    given: 'a job told to strip',
    should: 'cut the hold to those intervals, then record it stripped',
    actual: [stripped, finished],
    expected: [[['hold/b/', intervals]], ['stripped']],
  });
});
