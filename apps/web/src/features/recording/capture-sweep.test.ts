import { capturedMediaMs, recordingBuildCeilingMs } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createRecordingCaptureSweep } from './capture-sweep';
import type { RecordingCapturePort } from './capture-port';

setupRitewayBun();

const NOW = Date.parse('2026-11-03T10:00:00.000Z');
const at = new Date(NOW).toISOString();

const row = (over: Record<string, unknown> = {}) => ({
  id: 'rec',
  roundId: 'round',
  lifecycle: { status: 'requested' },
  eligibility: { kind: 'ranked' },
  competitionType: 'ranked',
  roundCapture: null,
  roundStatus: 'active',
  broadcast: {
    id: 'b',
    egressId: 'EG_1',
    attempt: 1,
    egressStartedAt: new Date(NOW),
    stoppedAt: null,
  },
  own: null,
  ...over,
});
const casualOwn = {
  competitionType: 'casual',
  eligibility: { kind: 'host_opt_in', hostActorId: 'host' },
  roundCapture: { broadcast: null, recordingPolicy: 'released' },
  broadcast: null,
};

const setup = (over: {
  readonly captureUntilMs?: number;
  readonly processing?: readonly unknown[];
  readonly open?: readonly unknown[];
  readonly jobs?: readonly unknown[];
  readonly unrecorded?: readonly unknown[];
  readonly egressRead?: unknown;
  readonly claim?: boolean;
  readonly startWon?: boolean;
  readonly verified?: string;
  readonly failing?: string;
}) => {
  const calls: unknown[][] = [];
  const cursors: (string | null)[] = [];
  const log =
    (name: string, answer?: unknown) =>
    async (...args: unknown[]) => {
      if (over.failing === name) throw new Error('down');
      calls.push([name, ...args]);
      return answer;
    };
  const sweep = createRecordingCaptureSweep({
    store: {
      discoverUnrecorded: async () => over.unrecorded ?? [],
      listExpiredTournamentAdmissions: async () => [],
      settleUndispatchedTournamentAdmission: log('settleUndispatched', true),
      listOpen: async () => over.open ?? [],
      listJobs: async (_limit: number, after: string | null) => {
        cursors.push(after);
        return after === null ? (over.jobs ?? []) : [];
      },
      readRound: async () => ({
        roomName: 'room-1',
        round: {},
      }),
      openOwn: log('openOwn'),
      claimOwn: async () => over.claim ?? true,
      holdOwn: log('holdOwn'),
      beginOwnEgressAttempt: log('beginOwnEgressAttempt', true),
      settleOwnEgressAttempt: log('settleOwnEgressAttempt', true),
      recordOwnEgressStarted: log(
        'recordOwnEgressStarted',
        over.startWon ?? true,
      ),
      recordOwnRevoked: log('recordOwnRevoked'),
      recordOwnRevocationFailed: log('recordOwnRevocationFailed'),
      recordOwnRestored: log('recordOwnRestored'),
      closeOwn: log('closeOwn'),
      openJob: log('openJob'),
      queueJob: log('queueJob'),
      readPublicHistory: async () => ({
        segments: [
          { startedAtMs: 1000, endedAtMs: 61_000, durationMs: 60_000 },
        ],
        knownThroughMs: 90_000,
        captureFromMs: 0,
        captureUntilMs: over.captureUntilMs ?? null,
        prepStartsAtMs: [],
      }),
      stripSources: log('stripSources'),
      discardSources: log('discardSources'),
      listProcessingUnalerted: async () => over.processing ?? [],
      markDelayAlerted: log('markDelayAlerted', true),
    } as never,
    port: {
      request: log('request'),
      captureStarted: log('captureStarted', 'moved'),
      captureEnded: log('captureEnded', 'moved'),
      mediaVerified: log('mediaVerified', over.verified ?? 'moved'),
      failed: log('failed', 'moved'),
    } as unknown as RecordingCapturePort,
    egress: {
      start: log('egress.start', 'EG_NEW') as never,
      stop: log('egress.stop') as never,
      readStageAttempt: async () => ({ kind: 'unresolved' }),
      read: (async () => over.egressRead ?? { kind: 'none' }) as never,
      revokeObserver: log('egress.revoke'),
      restoreObserver: log('egress.restore'),
    },
    holdsCapture: () => true,
    phaseAt: () => ({ kind: 'public' }),
    now: () => NOW,
    newCredential: () => ({ secret: 's3cret', hash: 'digest' }),
    stageUrl: (id, credential) =>
      `https://app.test/stage/${id}?c=${credential}`,
    report: (event) => calls.push(['report', event]),
  });
  return { sweep, calls, cursors };
};

describe('discovery', () => {
  test('requests a Recording with what the Round chose and the host holds', async () => {
    const { sweep, calls } = setup({
      unrecorded: [
        {
          roundId: 'round',
          competitionType: 'casual',
          hostActorId: 'host',
          capture: { broadcast: null, recordingPolicy: 'released' },
          hostGrants: [],
          tournamentAdmission: null,
        },
      ],
    });
    await sweep();
    assert({
      given: 'a casual Round whose host opted in',
      should: 'ask the port, which decides eligibility',
      actual: calls,
      expected: [
        [
          'request',
          {
            roundId: 'round',
            competitionType: 'casual',
            hostActorId: 'host',
            hostOptedIn: true,
            hostHoldsRecording: true,
            tournamentAdmission: null,
            now: at,
          },
        ],
      ],
    });
  });
});

describe('a Recording on a Broadcast', () => {
  test('opens its job before the capture is recorded, and runs no Egress', async () => {
    const { sweep, calls } = setup({ open: [row()] });
    await sweep();
    assert({
      given: 'the Broadcast Egress running',
      should: 'name the sources first, then report the attempt',
      actual: calls,
      expected: [
        ['openJob', { recordingId: 'rec', holdPrefix: 'hold/b/' }],
        [
          'captureStarted',
          'rec',
          {
            source: { kind: 'broadcast_hold', broadcastId: 'b' },
            attempt: 1,
            egressId: 'EG_1',
            at,
          },
        ],
      ],
    });
  });

  test('a failure on one reaches no other', async () => {
    const { sweep, calls } = setup({
      open: [row(), row({ id: 'other' })],
      failing: 'openJob',
    });
    await sweep();
    assert({
      given: 'two Recordings with the store refusing',
      should: 'report each and carry on',
      actual: calls,
      expected: [
        ['report', 'recording.capture_failed'],
        ['report', 'recording.capture_failed'],
      ],
    });
  });
});

describe('a Youth Round (ADR 0150)', () => {
  test('runs its own Egress, and keeps a Broadcast that opened before the deploy', async () => {
    const own = setup({
      open: [row({ ladderDivision: 'youth', broadcast: null })],
    });
    await own.sweep();
    const kept = setup({ open: [row({ ladderDivision: 'youth' })] });
    await kept.sweep();
    assert({
      given:
        'a Youth Round with no Broadcast, and one whose Broadcast already opened',
      should:
        'capture the first on its own Egress and follow the second’s Broadcast',
      actual: [own.calls, kept.calls].map((calls) =>
        calls
          .map((call) => call[0])
          .filter((name) => name === 'openOwn' || name === 'openJob'),
      ),
      expected: [['openOwn'], ['openJob']],
    });
  });
});

describe('a Recording with no Broadcast', () => {
  test('starts its own Egress under its own hold, storing only the digest', async () => {
    const { sweep, calls } = setup({ open: [row(casualOwn)] });
    await sweep();
    assert({
      given: 'nothing running',
      should: 'start attempt 1 and record it',
      actual: calls,
      expected: [
        ['openOwn', { recordingId: 'rec', roundId: 'round' }],
        ['holdOwn', { recordingId: 'rec', until: new Date(NOW + 15_000) }],
        [
          'beginOwnEgressAttempt',
          { recordingId: 'rec', generation: 1, stageCredentialHash: 'digest' },
        ],
        [
          'egress.start',
          {
            stageUrl: 'https://app.test/stage/rec?c=s3cret&g=1',
            holdPrefix: 'recording-hold/rec/1/',
            segmentSeconds: 4,
          },
        ],
        [
          'recordOwnEgressStarted',
          {
            recordingId: 'rec',
            egressId: 'EG_NEW',
            generation: 1,
            stageCredentialHash: 'digest',
            now: new Date(NOW),
          },
        ],
        ['holdOwn', { recordingId: 'rec', until: null }],
      ],
    });
  });

  test('a start that lost its attempt stops what it started', async () => {
    const { sweep, calls } = setup({ open: [row(casualOwn)], startWon: false });
    await sweep();
    assert({
      given: 'another instance having recorded this attempt first',
      should: 'report it, stop its own Egress and give the claim back',
      actual: calls.map(([name, arg]) =>
        name === 'report' || name === 'egress.stop' ? [name, arg] : [name],
      ),
      expected: [
        ['openOwn'],
        ['holdOwn'],
        ['beginOwnEgressAttempt'],
        ['egress.start'],
        ['recordOwnEgressStarted'],
        ['report', 'recording.egress.start_lost'],
        ['egress.stop', 'EG_NEW'],
        ['holdOwn'],
      ],
    });
  });

  test('another instance holding the lease means no second Egress', async () => {
    const { sweep, calls } = setup({ open: [row(casualOwn)], claim: false });
    await sweep();
    assert({
      given: 'the reconcile lease taken',
      should: 'do nothing beyond ensuring the row',
      actual: calls.map(([name]) => name),
      expected: ['openOwn'],
    });
  });
  test('an own Egress LiveKit no longer knows settles and says why, instead of failing', async () => {
    const { sweep, calls } = setup({
      open: [
        row({
          ...casualOwn,
          roundStatus: 'completed',
          own: {
            recordingId: 'rec',
            egressId: 'EG_old',
            attempt: 1,
            egressStartedAt: new Date(0),
            egressDispatchedAt: null,
            egressSettledAt: null,
            stageCredentialHash: null,
            observerRevokedAt: new Date(0),
            revocationFailures: 0,
          },
        }),
      ],
      egressRead: { kind: 'failed', id: 'EG_old', reason: 'not_found' },
    });
    await sweep();
    assert({
      given: 'a pre-Tab capture of an over Round whose Egress LiveKit dropped',
      should: 'settle that exact attempt and report it settled as absent',
      actual: calls.filter(
        ([name]) => name === 'settleOwnEgressAttempt' || name === 'report',
      ),
      expected: [
        [
          'settleOwnEgressAttempt',
          {
            recordingId: 'rec',
            generation: 1,
            egressId: 'EG_old',
            observation: { kind: 'failed', id: 'EG_old', reason: 'not_found' },
          },
        ],
        ['report', 'recording.egress.settled_absent'],
      ],
    });
  });
});

describe('answers to the worker', () => {
  test('a refused verification ends the Recording and says so, instead of retrying', async () => {
    const lifecycle = {
      status: 'processing',
      capture: {
        source: { kind: 'own_capture' },
        startedAt: at,
        endedAt: at,
        attempts: [{ attempt: 1, egressId: 'EG_1', startedAt: at }],
      },
    };
    const { sweep, calls } = setup({
      verified: 'refused',
      jobs: [
        {
          recordingId: 'rec',
          state: { status: 'built', media: { playlistKey: 'elsewhere' } },
          lifecycle,
          sourcesInUse: false,
        },
      ],
    });
    await sweep();
    assert({
      given: 'built media the Recording refuses',
      should: 'report it and fail the Recording, which leaves the job list',
      actual: calls.map(([name, , detail]) =>
        name === 'report'
          ? [name, calls.find(([n]) => n === 'report')?.[1]]
          : name === 'failed'
            ? [name, (detail as { reason: string }).reason]
            : [name],
      ),
      expected: [
        ['mediaVerified'],
        ['report', 'recording.verification_refused'],
        ['failed', 'verification_failed'],
      ],
    });
  });
  const media = {
    capturedFrom: at,
    playlistKey: 'recordings/rec/hls/master.m3u8',
    downloadKey: 'recordings/rec/video.mp4',
    durationMs: 1000,
    byteSize: 1,
    verifiedAt: at,
    gaps: [],
  };
  const processing = {
    status: 'processing',
    capture: {
      source: { kind: 'own_capture' },
      startedAt: at,
      endedAt: at,
      attempts: [{ attempt: 2, egressId: 'EG_2', startedAt: at }],
    },
  };
  test('a built report becomes ready only through the port', async () => {
    const { sweep, calls } = setup({
      jobs: [
        {
          recordingId: 'rec',
          state: { status: 'built', media },
          lifecycle: processing,
          sourcesInUse: false,
        },
      ],
    });
    await sweep();
    assert({
      given: 'a built report',
      should: 'report it to the capture port',
      actual: calls,
      expected: [['mediaVerified', 'rec', media]],
    });
  });
  test('capture having ended, the job is queued for every attempt', async () => {
    const { sweep, calls } = setup({
      jobs: [
        {
          recordingId: 'rec',
          state: { status: 'waiting' },
          lifecycle: processing,
          sourcesInUse: false,
        },
      ],
    });
    await sweep();
    assert({
      given: 'a waiting job',
      should: 'queue up to the last attempt',
      actual: calls,
      expected: [
        [
          'queueJob',
          {
            recordingId: 'rec',
            attemptCount: 2,
            publicIntervals: [{ fromMs: 2301, toMs: 61_000 }],
            ceilingMs: recordingBuildCeilingMs(
              capturedMediaMs(processing.capture),
            ),
          },
        ],
      ],
    });
  });
});

test('a build past its bound alerts an operator once, and fails nothing', async () => {
  const processing = (endedAtMs: number) => ({
    id: 'rec',
    lifecycle: {
      status: 'processing',
      capture: {
        source: { kind: 'own_capture' },
        // An 80 minute capture: half of it plus five minutes is 45 minutes.
        startedAt: new Date(endedAtMs - 80 * 60_000).toISOString(),
        attempts: [],
        endedAt: new Date(endedAtMs).toISOString(),
      },
    },
  });
  const names = (calls: unknown[][]) =>
    calls.map(([name, event]) => (name === 'report' ? event : name));
  const within = setup({ processing: [processing(NOW - 45 * 60_000)] });
  await within.sweep();
  assert({
    given: 'an 80 minute capture exactly at its 45 minute bound',
    should: 'say nothing',
    actual: names(within.calls),
    expected: [],
  });
  const past = setup({ processing: [processing(NOW - 45 * 60_000 - 1)] });
  await past.sweep();
  assert({
    given: 'the same capture just past it',
    should: 'mark and alert, and never report the Recording failed',
    actual: names(past.calls),
    expected: ['markDelayAlerted', 'recording.processing_delayed'],
  });
});

test('a full page of jobs continues from the last row\u2019s own id', async () => {
  const jobs = Array.from({ length: 64 }, (_, index) => ({
    recordingId: `rec-${String(index).padStart(2, '0')}`,
    state: { status: 'settled', settledAt: at },
    lifecycle: { status: 'ready' },
    sourcesInUse: false,
  }));
  const { sweep, cursors } = setup({ jobs });
  await sweep();
  assert({
    given: 'a whole page of jobs',
    should:
      'ask for the next by the id the store sorts on, not the pass\u2019s key',
    actual: cursors,
    expected: [null, 'rec-63'],
  });
});

test('late physical capture never extends a finite authorization in either queued or retained sources', async () => {
  const { sweep, calls } = setup({
    captureUntilMs: 30_000,
    jobs: [
      {
        recordingId: 'queue',
        state: { status: 'waiting' },
        lifecycle: {
          status: 'processing',
          capture: {
            source: { kind: 'own_capture' },
            startedAt: at,
            endedAt: at,
            attempts: [{ attempt: 1, egressId: 'EG_1', startedAt: at }],
          },
        },
        sourcesInUse: false,
      },
      {
        recordingId: 'strip',
        state: { status: 'failed' },
        lifecycle: { status: 'failed' },
        sourcesInUse: false,
      },
    ],
  });
  await sweep();
  assert({
    given:
      'committed speech and physical sources extending past the immutable deadline',
    should:
      'pass the same deadline-clipped public interval to both build and private-source stripping',
    actual: calls
      .filter(([name]) => name === 'queueJob' || name === 'stripSources')
      .map(([name, input]) => [
        name,
        (input as { publicIntervals: unknown }).publicIntervals,
      ]),
    expected: [
      ['queueJob', [{ fromMs: 2301, toMs: 30_000 }]],
      ['stripSources', [{ fromMs: 2301, toMs: 30_000 }]],
    ],
  });
});
