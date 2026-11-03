import type { RecordingLifecycle } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  answerRecordingJob,
  decideRecordingCapture,
  type RecordingCaptureFacts,
} from './capture-decision';

setupRitewayBun();

const at = '2026-11-03T10:00:00.000Z';
const source = { kind: 'broadcast_hold', broadcastId: 'b' } as const;
const capturing: RecordingLifecycle = {
  status: 'capturing',
  capture: {
    source,
    startedAt: at,
    attempts: [{ attempt: 1, egressId: 'EG_1', startedAt: at }],
  },
};
const processing: RecordingLifecycle = {
  status: 'processing',
  capture: {
    source,
    startedAt: at,
    endedAt: at,
    attempts: [
      { attempt: 1, egressId: 'EG_1', startedAt: at },
      { attempt: 3, egressId: 'EG_3', startedAt: at },
    ],
  },
};
const requested: RecordingLifecycle = { status: 'requested' };
const removing: RecordingLifecycle = {
  status: 'removing',
  cause: 'participant_request',
  requestedAt: at,
};
const takenDown: RecordingLifecycle = {
  status: 'taken_down',
  takenDownAt: at,
  held: null,
};
const attempt = (n: number) => ({
  attempt: n,
  egressId: `EG_${n}`,
  startedAtMs: 1000,
});
const active = { kind: 'active', id: 'EG_1' } as const;

const onBroadcast = (
  over: Partial<RecordingCaptureFacts> & {
    readonly latest?: ReturnType<typeof attempt> | null;
    readonly stopped?: boolean;
    readonly egress?: Parameters<
      typeof decideRecordingCapture
    >[0]['path']['egress'];
    readonly broadcastId?: string | null;
  } = {},
): RecordingCaptureFacts => ({
  nowMs: 1000,
  lifecycle: over.lifecycle ?? capturing,
  roundEnded: over.roundEnded ?? false,
  path: {
    kind: 'broadcast',
    broadcastId: over.broadcastId === undefined ? 'b' : over.broadcastId,
    latest: over.latest === undefined ? attempt(1) : over.latest,
    stopped: over.stopped ?? false,
    egress: over.egress ?? active,
  },
});

describe('a Recording on a Broadcast', () => {
  test('reports every attempt in order, and only new ones', () => {
    assert({
      given: 'the first Egress running',
      should: 'start capture from the Broadcast hold',
      actual: decideRecordingCapture(onBroadcast({ lifecycle: requested })),
      expected: [{ type: 'report-started', source, attempt: attempt(1) }],
    });
    assert({
      given: 'that attempt already recorded',
      should: 'do nothing',
      actual: decideRecordingCapture(onBroadcast()),
      expected: [],
    });
    assert({
      given: 'a crash that started attempt 2',
      should: 'report the new attempt',
      actual: decideRecordingCapture(onBroadcast({ latest: attempt(2) })),
      expected: [{ type: 'report-started', source, attempt: attempt(2) }],
    });
  });

  test('ends only once no Egress can still be writing', () => {
    assert({
      given: 'a Round over with its Egress still uploading',
      should: 'wait',
      actual: decideRecordingCapture(onBroadcast({ roundEnded: true })),
      expected: [],
    });
    assert({
      given: 'a Round over and the Egress complete',
      should: 'end capture, with no timer',
      actual: decideRecordingCapture(
        onBroadcast({ roundEnded: true, egress: { kind: 'complete' } }),
      ),
      expected: [{ type: 'report-ended' }],
    });
    assert({
      given: 'a stopped Broadcast with its Egress gone and the Round going on',
      should: 'end capture: a stop is final and no more media comes',
      actual: decideRecordingCapture(
        onBroadcast({ stopped: true, egress: { kind: 'complete' } }),
      ),
      expected: [{ type: 'report-ended' }],
    });
    assert({
      given: 'a Round over with a last attempt nobody reported',
      should: 'report it before ending, so nothing is lost',
      actual: decideRecordingCapture(
        onBroadcast({
          roundEnded: true,
          egress: { kind: 'complete' },
          latest: attempt(2),
        }),
      ),
      expected: [{ type: 'report-started', source, attempt: attempt(2) }],
    });
    assert({
      given: 'a Round over whose failed Egress the Broadcast will never finish',
      should: 'still end: a Recording does not wait on Broadcast completion',
      actual: decideRecordingCapture(
        onBroadcast({
          roundEnded: true,
          egress: { kind: 'failed', id: 'EG_1' },
        }),
      ),
      expected: [{ type: 'report-ended' }],
    });
  });

  test('says so when nothing was ever captured', () => {
    assert({
      given: 'a Round over with no Egress and no Broadcast',
      should: 'fail honestly',
      actual: decideRecordingCapture(
        onBroadcast({
          lifecycle: requested,
          roundEnded: true,
          latest: null,
          broadcastId: null,
          egress: { kind: 'none' },
        }),
      ),
      expected: [{ type: 'report-failed' }],
    });
  });

  test('leaves a finished Recording alone', () => {
    assert({
      given: 'a Recording already processing',
      should: 'do nothing',
      actual: decideRecordingCapture(onBroadcast({ lifecycle: processing })),
      expected: [],
    });
  });
});

const onOwn = (
  over: Partial<Omit<RecordingCaptureFacts, 'path'>> & {
    readonly latest?: ReturnType<typeof attempt> | null;
    readonly egress?: Parameters<
      typeof decideRecordingCapture
    >[0]['path']['egress'];
    readonly phase?: { readonly kind: 'public' } | { readonly kind: 'private' };
    readonly observerSubscribed?: boolean;
    readonly revocationFailures?: number;
  } = {},
): RecordingCaptureFacts => ({
  nowMs: 1000,
  lifecycle: over.lifecycle ?? {
    status: 'capturing',
    capture: {
      source: { kind: 'own_capture' },
      startedAt: at,
      attempts: [{ attempt: 1, egressId: 'EG_1', startedAt: at }],
    },
  },
  roundEnded: over.roundEnded ?? false,
  path: {
    kind: 'own',
    latest: over.latest === undefined ? attempt(1) : over.latest,
    egress: over.egress ?? active,
    phase: over.phase ?? { kind: 'public' },
    observerSubscribed: over.observerSubscribed ?? true,
    revocationFailures: over.revocationFailures ?? 0,
  },
});

describe('a Recording running its own Egress', () => {
  test('starts one, and starts another after a crash', () => {
    assert({
      given: 'nothing running yet',
      should: 'start an Egress',
      actual: decideRecordingCapture(
        onOwn({
          lifecycle: requested,
          latest: null,
          egress: { kind: 'none' },
        }),
      ),
      expected: [{ type: 'start-egress' }],
    });
    assert({
      given: 'a crashed Egress mid-Round',
      should: 'start the next attempt',
      actual: decideRecordingCapture(
        onOwn({ egress: { kind: 'failed', id: 'EG_1' } }),
      ),
      expected: [{ type: 'start-egress' }],
    });
    assert({
      given: 'a new attempt running',
      should: 'report it',
      actual: decideRecordingCapture(onOwn({ latest: attempt(2) })),
      expected: [
        {
          type: 'report-started',
          source: { kind: 'own_capture' },
          attempt: attempt(2),
        },
      ],
    });
  });

  test('obeys the same privacy boundary as a Broadcast', () => {
    assert({
      given: 'a private phase with the observer subscribed',
      should: 'revoke',
      actual: decideRecordingCapture(onOwn({ phase: { kind: 'private' } })),
      expected: [{ type: 'revoke-observer' }],
    });
    assert({
      given: 'a revocation that failed',
      should: 'fail closed by stopping the Egress',
      actual: decideRecordingCapture(
        onOwn({ phase: { kind: 'private' }, revocationFailures: 1 }),
      ),
      expected: [{ type: 'stop-egress', id: 'EG_1' }],
    });
    assert({
      given: 'a revoked observer with the Egress still running',
      should: 'say it again, in case a stage just rejoined',
      actual: decideRecordingCapture(
        onOwn({ phase: { kind: 'private' }, observerSubscribed: false }),
      ),
      expected: [{ type: 'reassert-revocation' }],
    });
    assert({
      given: 'the phase public again',
      should: 'restore',
      actual: decideRecordingCapture(onOwn({ observerSubscribed: false })),
      expected: [{ type: 'restore-observer' }],
    });
  });

  test('stops with the Round, and closes once nothing runs', () => {
    assert({
      given: 'the Round over and the Egress running',
      should: 'stop it',
      actual: decideRecordingCapture(onOwn({ roundEnded: true })),
      expected: [{ type: 'stop-egress', id: 'EG_1' }],
    });
    assert({
      given: 'the Round over and the Egress done',
      should: 'end capture and close',
      actual: decideRecordingCapture(
        onOwn({ roundEnded: true, egress: { kind: 'complete' } }),
      ),
      expected: [{ type: 'report-ended' }, { type: 'close-own-capture' }],
    });
    assert({
      given: 'the Round over and no Egress ever ran',
      should: 'fail honestly and close',
      actual: decideRecordingCapture(
        onOwn({
          lifecycle: requested,
          roundEnded: true,
          latest: null,
          egress: { kind: 'none' },
        }),
      ),
      expected: [{ type: 'report-failed' }, { type: 'close-own-capture' }],
    });
  });

  test('stops capturing the moment a Recording is hidden or removed', () => {
    for (const lifecycle of [removing, takenDown])
      assert({
        given: `a Recording ${lifecycle.status} mid-capture`,
        should: 'stop its Egress',
        actual: decideRecordingCapture(onOwn({ lifecycle })),
        expected: [{ type: 'stop-egress', id: 'EG_1' }],
      });
    assert({
      given: 'that Egress gone',
      should: 'close, reporting nothing to a Recording no longer open',
      actual: decideRecordingCapture(
        onOwn({ lifecycle: removing, egress: { kind: 'complete' } }),
      ),
      expected: [{ type: 'close-own-capture' }],
    });
  });
});

describe('answerRecordingJob', () => {
  const answer = (
    state: Parameters<typeof answerRecordingJob>[0]['state'],
    lifecycle: RecordingLifecycle,
    sourcesInUse = false,
  ) => answerRecordingJob({ state, lifecycle, sourcesInUse });
  const media = {
    capturedFrom: at,
    playlistKey: 'recordings/r/hls/master.m3u8',
    downloadKey: 'recordings/r/video.mp4',
    durationMs: 1000,
    byteSize: 1,
    verifiedAt: at,
    gaps: [],
  };
  const ready: RecordingLifecycle = {
    status: 'ready',
    capture: processing.capture,
    media: { ...media, speeches: [] },
  };

  test('queues every attempt once capture has ended', () => {
    assert({
      given: 'attempts 1 and 3 recorded, 2 never reported',
      should: 'read up to the last, so a missed attempt is still looked for',
      actual: answer({ status: 'waiting' }, processing),
      expected: { type: 'queue', attemptCount: 3, ceilingMs: 15 * 60_000 },
    });
  });

  test('turns the worker report into the Recording state', () => {
    assert({
      given: 'a built report',
      should: 'verify through the capture port',
      actual: answer({ status: 'built', media }, processing),
      expected: { type: 'verify' },
    });
    assert({
      given: 'a failed report',
      should: 'carry its reason',
      actual: answer(
        { status: 'failed', reason: 'no_media', failedAt: at },
        processing,
      ),
      expected: { type: 'fail', reason: 'no_media' },
    });
    assert({
      given: 'a queued job while processing',
      should: 'wait for the worker',
      actual: answer(
        { status: 'queued', attemptCount: 1, publicIntervals: [] },
        processing,
      ),
      expected: null,
    });
  });

  test('sources go only when no one needs them', () => {
    assert({
      given: 'a ready Recording with its Broadcast finished',
      should: 'discard, keeping the whole MP4 in its own bucket',
      actual: answer({ status: 'built', media }, ready),
      expected: { type: 'discard-sources' },
    });
    assert({
      given: 'a ready Recording whose Broadcast still releases from the hold',
      should: 'wait: a scheduled release can be hours off',
      actual: answer({ status: 'built', media }, ready, true),
      expected: null,
    });
    assert({
      given: 'a removal asked during capture',
      should: 'discard what the capture left',
      actual: answer({ status: 'waiting' }, removing),
      expected: { type: 'discard-sources' },
    });
    assert({
      given: 'a running build when removal is asked',
      should: 'discard, which fences that build',
      actual: answer(
        { status: 'queued', attemptCount: 1, publicIntervals: [] },
        removing,
      ),
      expected: { type: 'discard-sources' },
    });
    assert({
      given: 'a Recording taken down during processing',
      should: 'keep the sources as evidence',
      actual: answer({ status: 'built', media }, takenDown),
      expected: null,
    });
  });

  test('a job with nothing left needs no answer', () => {
    assert({
      given: 'a discard under way',
      should: 'leave it to the worker',
      actual: answer({ status: 'discarding' }, removing),
      expected: null,
    });
    assert({
      given: 'a settled job',
      should: 'be done',
      actual: answer({ status: 'settled', settledAt: at }, ready),
      expected: null,
    });
  });
});

describe('a failed Recording keeps no private seconds', () => {
  const failed = {
    status: 'failed',
    reason: 'processing_failed',
    failedAt: at,
  } as const;
  const answer = (
    state: Parameters<typeof answerRecordingJob>[0]['state'],
    sourcesInUse = false,
  ) => answerRecordingJob({ state, lifecycle: failed, sourcesInUse });
  test('its sources are stripped once nothing reads them, and only once', () => {
    assert({
      given:
        'a failed job free; still read by a Broadcast; stripping; stripped',
      should: 'strip the first, and leave the rest',
      actual: [
        answer({ status: 'failed', reason: 'processing_failed', failedAt: at }),
        answer({ status: 'waiting' }, true),
        answer({ status: 'stripping', publicIntervals: [] }),
        answer({ status: 'stripped', strippedAt: at }),
      ],
      expected: [{ type: 'strip-sources' }, null, null, null],
    });
  });
});
