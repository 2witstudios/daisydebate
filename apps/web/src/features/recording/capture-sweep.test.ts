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
  roundCapture: { broadcast: null, recording: true },
  broadcast: null,
};

const setup = (over: {
  readonly open?: readonly unknown[];
  readonly jobs?: readonly unknown[];
  readonly unrecorded?: readonly unknown[];
  readonly egressRead?: unknown;
  readonly claim?: boolean;
  readonly failing?: string;
}) => {
  const calls: unknown[][] = [];
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
      listOpen: async () => over.open ?? [],
      listJobs: async () => over.jobs ?? [],
      readRound: async () => ({
        roomName: 'room-1',
        round: {},
      }),
      openOwn: log('openOwn'),
      claimOwn: async () => over.claim ?? true,
      recordOwnEgressStarted: log('recordOwnEgressStarted'),
      recordOwnRevoked: log('recordOwnRevoked'),
      recordOwnRevocationFailed: log('recordOwnRevocationFailed'),
      recordOwnRestored: log('recordOwnRestored'),
      closeOwn: log('closeOwn'),
      openJob: log('openJob'),
      queueJob: log('queueJob'),
      discardSources: log('discardSources'),
    } as never,
    port: {
      request: log('request'),
      captureStarted: log('captureStarted', 'moved'),
      captureEnded: log('captureEnded', 'moved'),
      mediaVerified: log('mediaVerified', 'moved'),
      failed: log('failed', 'moved'),
    } as unknown as RecordingCapturePort,
    egress: {
      start: log('egress.start', 'EG_NEW') as never,
      stop: log('egress.stop') as never,
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
  return { sweep, calls };
};

describe('discovery', () => {
  test('requests a Recording with what the Round chose and the host holds', async () => {
    const { sweep, calls } = setup({
      unrecorded: [
        {
          roundId: 'round',
          competitionType: 'casual',
          hostActorId: 'host',
          capture: { broadcast: null, recording: true },
          hostGrants: [],
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
        [
          'egress.start',
          {
            stageUrl: 'https://app.test/stage/rec?c=s3cret',
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
});

describe('answers to the worker', () => {
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
      expected: [['queueJob', { recordingId: 'rec', attemptCount: 2 }]],
    });
  });
});
