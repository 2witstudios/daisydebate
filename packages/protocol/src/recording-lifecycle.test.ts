import {
  recordingHiddenByModeration,
  type RecordingLifecycle,
  type RecordingMedia,
} from './recording';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  transitionRecording,
  type RecordingEvent,
} from './recording-lifecycle';

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
  const down = {
    type: 'taken_down',
    at: later,
    reason: 'legal_request',
  } as const;
  test('hides at once and keeps what a restore needs', () => {
    assert({
      given: 'a ready ranked Recording',
      should: 'be taken down holding its media',
      actual: apply(ready, down, 'ranked'),
      expected: {
        kind: 'moved',
        next: {
          status: 'taken_down',
          takenDownAt: later,
          reason: 'legal_request',
          held: ready,
        },
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

describe('an evidence hold on a taken-down casual Recording', () => {
  const down: RecordingLifecycle = {
    status: 'taken_down',
    takenDownAt: at,
    held: ready,
  };
  const heldUntil = '2027-02-01T00:00:00.000Z';
  const asked = {
    type: 'removal_requested',
    cause: 'participant_request',
    at: later,
    evidenceHeldUntil: heldUntil,
  } as const;
  const owed: RecordingLifecycle = {
    ...down,
    removalOwed: { requestedAt: later, heldUntil },
  };
  const going = {
    kind: 'moved',
    next: {
      status: 'removing',
      cause: 'participant_request',
      requestedAt: later,
    },
  } as const;

  test('erasure under an open report owes the removal and keeps the media', () => {
    assert({
      given: 'a request while an open report holds the Recording',
      should: 'stay taken down, recording what is owed',
      actual: apply(down, asked),
      expected: { kind: 'moved', next: owed },
    });
    assert({
      given: 'a second seat asking while one is owed',
      should: 'keep the first, so a hold is never extended',
      actual: apply(owed, { ...asked, at: heldUntil }),
      expected: { kind: 'unchanged' },
    });
  });

  test('erasure with no open report removes it now', () => {
    assert({
      given: 'a request with no hold',
      should: 'go at once',
      actual: apply(down, {
        type: 'removal_requested',
        cause: 'participant_request',
        at: later,
      }),
      expected: going,
    });
  });

  test('the owed removal is paid when the hold ends, and only then', () => {
    assert({
      given: 'the report closed or the period passed',
      should: 'move to removing, dated by the request',
      actual: apply(owed, { type: 'evidence_hold_ended' }),
      expected: going,
    });
    assert({
      given: 'a takedown that owes nothing',
      should: 'refuse: a takedown alone is never deleted by time',
      actual: apply(down, { type: 'evidence_hold_ended' }),
      expected: { kind: 'refused', reason: 'out_of_order' },
    });
    assert({
      given: 'a removal already under way',
      should: 'change nothing',
      actual: apply(removing, { type: 'evidence_hold_ended' }),
      expected: { kind: 'unchanged' },
    });
  });

  test('a restore never brings back what a subject asked to remove', () => {
    assert({
      given: 'a restore of a Recording with a removal owed',
      should: 'refuse: it stays hidden until the hold ends',
      actual: apply(owed, { type: 'restored' }),
      expected: { kind: 'refused', reason: 'not_restorable' },
    });
  });

  test('moderation removal waits for the hold; a legal removal does not', () => {
    assert({
      given: 'an ordinary moderation removal of a held Recording',
      should: 'refuse',
      actual: apply(owed, {
        type: 'removal_requested',
        cause: 'moderation',
        at: heldUntil,
      }),
      expected: { kind: 'refused', reason: 'evidence_held' },
    });
    assert({
      given: 'a legal removal of the same',
      should: 'go at once, as a legal removal',
      actual: apply(owed, {
        type: 'removal_requested',
        cause: 'legal_removal',
        at: heldUntil,
      }),
      expected: {
        kind: 'moved',
        next: {
          status: 'removing',
          cause: 'legal_removal',
          requestedAt: heldUntil,
        },
      },
    });
    assert({
      given: 'an ordinary moderation removal with no hold',
      should: 'still go',
      actual: apply(down, {
        type: 'removal_requested',
        cause: 'moderation',
        at: heldUntil,
      }),
      expected: {
        kind: 'moved',
        next: {
          status: 'removing',
          cause: 'moderation',
          requestedAt: heldUntil,
        },
      },
    });
  });
});

describe('a rebuild', () => {
  const failed: RecordingLifecycle = {
    status: 'failed',
    reason: 'processing_failed',
    failedAt: later,
    capture: endedCapture,
  };

  test('a failed build keeps the capture it would go back to', () => {
    assert({
      given: 'a build failing while processing',
      should: 'keep the finished capture on the failure',
      actual: apply(processing, {
        type: 'failed',
        reason: 'processing_failed',
        at: later,
      }),
      expected: { kind: 'moved', next: failed },
    });
  });

  test('goes back to processing for ranked only', () => {
    const asked = { type: 'rebuild_requested' } as const;
    assert({
      given: 'a failed ranked build',
      should: 'return to processing on the same capture',
      actual: apply(failed, asked, 'ranked'),
      expected: { kind: 'moved', next: processing },
    });
    assert({
      given: 'a failed casual build, and a ranked capture that never finished',
      should: 'refuse both',
      actual: [
        apply(failed, asked, 'casual'),
        apply(
          { status: 'failed', reason: 'capture_failed', failedAt: later },
          asked,
          'ranked',
        ),
      ],
      expected: [
        { kind: 'refused', reason: 'not_rebuildable' },
        { kind: 'refused', reason: 'not_rebuildable' },
      ],
    });
    assert({
      given: 'a repeat once it is processing, and a ready Recording',
      should: 'change nothing, and refuse',
      actual: [
        apply(processing, asked, 'ranked'),
        apply(ready, asked, 'ranked'),
      ],
      expected: [
        { kind: 'unchanged' },
        { kind: 'refused', reason: 'out_of_order' },
      ],
    });
  });
});

describe('recordingHiddenByModeration', () => {
  test('is moderation\u2019s decision, not any removal', () => {
    const removing = (
      cause:
        | 'moderation'
        | 'legal_removal'
        | 'participant_request'
        | 'failed_capture_cleanup',
    ) => ({ status: 'removing', cause, requestedAt: at }) as const;
    assert({
      given: 'each way a Recording stops showing',
      should: 'count takedown and moderation removals only',
      actual: [
        recordingHiddenByModeration({
          status: 'taken_down',
          takenDownAt: at,
          held: null,
        }),
        recordingHiddenByModeration(removing('moderation')),
        recordingHiddenByModeration(removing('legal_removal')),
        recordingHiddenByModeration(removing('participant_request')),
        recordingHiddenByModeration(removing('failed_capture_cleanup')),
        recordingHiddenByModeration(ready),
      ],
      expected: [true, true, true, false, false, false],
    });
  });
});
