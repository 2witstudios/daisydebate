import type { RecordingLifecycle, RecordingMedia } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { transitionRecording, type RecordingEvent } from './lifecycle';

setupRitewayBun();

const at = '2026-11-02T10:00:00.000Z';
const later = '2026-11-02T11:00:00.000Z';
const id = 'r1';
const prefix = `recordings/${id}/`;
const source = { kind: 'broadcast_hold', broadcastId: 'b1' } as const;
const capture = {
  source,
  startedAt: at,
  attempts: [{ attempt: 1, egressId: 'EG_1', startedAt: at }],
};
const endedCapture = { ...capture, endedAt: later };
const media: RecordingMedia = {
  capturedFrom: at,
  playlistKey: `${prefix}hls/master.m3u8`,
  downloadKey: `${prefix}video.mp4`,
  durationMs: 60_000,
  byteSize: 1000,
  verifiedAt: later,
  gaps: [],
  speeches: [],
};
const ready: RecordingLifecycle = {
  status: 'ready',
  capture: endedCapture,
  media,
};
const processing: RecordingLifecycle = {
  status: 'processing',
  capture: endedCapture,
};
const removing: RecordingLifecycle = {
  status: 'removing',
  cause: 'participant_request',
  requestedAt: at,
};

const apply = (
  lifecycle: RecordingLifecycle,
  event: RecordingEvent,
  recordingClass: 'ranked' | 'casual' = 'casual',
) => transitionRecording({ id, class: recordingClass, lifecycle }, event);

describe('capture', () => {
  test('moves forward once, whatever is repeated', () => {
    const started = {
      type: 'capture_started',
      source,
      attempt: 1,
      egressId: 'EG_1',
      at,
    } as const;
    assert({
      given: 'a requested Recording whose capture starts',
      should: 'be capturing',
      actual: apply({ status: 'requested' }, started),
      expected: {
        kind: 'moved',
        next: { status: 'capturing', capture },
      },
    });
    assert({
      given: 'the same start reported twice',
      should: 'change nothing',
      actual: apply({ status: 'capturing', capture }, started).kind,
      expected: 'unchanged',
    });
    assert({
      given: 'a different Egress claiming a number already taken',
      should: 'refuse rather than duplicate the artifact',
      actual: apply(
        { status: 'capturing', capture },
        { ...started, egressId: 'EG_2' },
      ),
      expected: { kind: 'refused', reason: 'different_capture' },
    });
    assert({
      given: 'a capture reported from another source',
      should: 'refuse, so two sources never share one timeline',
      actual: apply(
        { status: 'capturing', capture },
        { ...started, source: { kind: 'own_capture' } },
      ),
      expected: { kind: 'refused', reason: 'different_capture' },
    });
    const ended = { type: 'capture_ended', at: later } as const;
    assert({
      given: 'capture ending',
      should: 'move to processing',
      actual: apply({ status: 'capturing', capture }, ended),
      expected: { kind: 'moved', next: processing },
    });
    assert({
      given: 'the end reported again',
      should: 'change nothing',
      actual: apply(processing, ended).kind,
      expected: 'unchanged',
    });
    assert({
      given: 'capture ending before it started',
      should: 'refuse',
      actual: apply({ status: 'requested' }, ended),
      expected: { kind: 'refused', reason: 'out_of_order' },
    });
  });

  test('spans every Egress attempt, in order', () => {
    const second = {
      type: 'capture_started',
      source,
      attempt: 2,
      egressId: 'EG_2',
      at: later,
    } as const;
    const restarted = {
      ...capture,
      attempts: [
        ...capture.attempts,
        { attempt: 2, egressId: 'EG_2', startedAt: later },
      ],
    };
    assert({
      given: 'a crash starting a new attempt',
      should: 'keep the first start and add the attempt',
      actual: apply({ status: 'capturing', capture }, second),
      expected: {
        kind: 'moved',
        next: { status: 'capturing', capture: restarted },
      },
    });
    assert({
      given: 'that attempt reported again',
      should: 'change nothing',
      actual: apply({ status: 'capturing', capture: restarted }, second).kind,
      expected: 'unchanged',
    });
    assert({
      given: 'an attempt number lower than the last and not recorded',
      should: 'refuse rather than reorder',
      actual: apply(
        {
          status: 'capturing',
          capture: {
            ...capture,
            attempts: [{ attempt: 3, egressId: 'EG_3', startedAt: at }],
          },
        },
        second,
      ),
      expected: { kind: 'refused', reason: 'out_of_order' },
    });
  });
});

describe('readiness', () => {
  test('comes only from verified media', () => {
    const verified = { type: 'media_verified', media } as const;
    assert({
      given: 'verified media while processing',
      should: 'be ready',
      actual: apply(processing, verified),
      expected: { kind: 'moved', next: ready },
    });
    assert({
      given: 'verification retried',
      should: 'change nothing',
      actual: apply(ready, verified).kind,
      expected: 'unchanged',
    });
    assert({
      given: 'media verified before capture ended',
      should: 'refuse false readiness',
      actual: apply({ status: 'capturing', capture }, verified),
      expected: { kind: 'refused', reason: 'out_of_order' },
    });
    assert({
      given: 'media naming an object outside the prefix',
      should: 'refuse',
      actual: apply(processing, {
        type: 'media_verified',
        media: { ...media, downloadKey: 'public/video.mp4' },
      }),
      expected: { kind: 'refused', reason: 'foreign_object' },
    });
    assert({
      given: 'a late failure from an ambiguous vendor once ready',
      should: 'keep the Recording ready',
      actual: apply(ready, {
        type: 'failed',
        reason: 'capture_failed',
        at: later,
      }),
      expected: { kind: 'refused', reason: 'out_of_order' },
    });
  });
});

describe('takedown', () => {
  const down = { type: 'taken_down', at: later } as const;
  test('hides at once and keeps what a restore needs', () => {
    assert({
      given: 'a ready ranked Recording',
      should: 'be taken down holding its media',
      actual: apply(ready, down, 'ranked'),
      expected: {
        kind: 'moved',
        next: { status: 'taken_down', takenDownAt: later, held: ready },
      },
    });
    assert({
      given: 'a restore of what was ready',
      should: 'put it back unchanged',
      actual: apply(
        { status: 'taken_down', takenDownAt: later, held: ready },
        { type: 'restored' },
      ),
      expected: { kind: 'moved', next: ready },
    });
    assert({
      given: 'a restore of one taken down before it finished',
      should: 'refuse',
      actual: apply(
        { status: 'taken_down', takenDownAt: later, held: null },
        { type: 'restored' },
      ),
      expected: { kind: 'refused', reason: 'not_restorable' },
    });
    assert({
      given: 'processing finishing after a takedown',
      should: 'never become ready',
      actual: apply(
        { status: 'taken_down', takenDownAt: later, held: null },
        { type: 'media_verified', media },
      ),
      expected: { kind: 'refused', reason: 'out_of_order' },
    });
  });
});

describe('removal', () => {
  const participant = {
    type: 'removal_requested',
    cause: 'participant_request',
    at: later,
  } as const;
  test('a participant removes casual, never ranked', () => {
    assert({
      given: 'a participant asking on a ranked Recording',
      should: 'refuse and keep it',
      actual: apply(ready, participant, 'ranked'),
      expected: { kind: 'refused', reason: 'ranked_is_kept' },
    });
    assert({
      given: 'a participant asking on a casual Recording',
      should: 'record the durable intent for the whole Recording',
      actual: apply(ready, participant),
      expected: {
        kind: 'moved',
        next: {
          status: 'removing',
          cause: 'participant_request',
          requestedAt: later,
        },
      },
    });
    assert({
      given: 'moderation on a ranked Recording',
      should: 'remove it',
      actual: apply(
        { status: 'taken_down', takenDownAt: at, held: ready },
        { ...participant, cause: 'moderation' },
        'ranked',
      ).kind,
      expected: 'moved',
    });
    assert({
      given: 'a repeated request',
      should: 'keep the first intent',
      actual: apply(removing, participant).kind,
      expected: 'unchanged',
    });
    assert({
      given: 'capture reporting after removal was asked',
      should: 'not bring it back',
      actual: apply(removing, {
        type: 'capture_started',
        source,
        attempt: 1,
        egressId: 'EG_1',
        at,
      }),
      expected: { kind: 'refused', reason: 'out_of_order' },
    });
  });

  test('only finished deletion ends it', () => {
    assert({
      given: 'objects gone while removing',
      should: 'be removed, keeping why',
      actual: apply(removing, { type: 'objects_gone', at: later }),
      expected: {
        kind: 'moved',
        next: {
          status: 'removed',
          cause: 'participant_request',
          requestedAt: at,
          removedAt: later,
        },
      },
    });
    assert({
      given: 'objects gone with no intent',
      should: 'refuse',
      actual: apply(ready, { type: 'objects_gone', at: later }),
      expected: { kind: 'refused', reason: 'out_of_order' },
    });
  });
});
