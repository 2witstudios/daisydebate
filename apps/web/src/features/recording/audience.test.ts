import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  mayDownload,
  mayRequestRemoval,
  recordingMediaState,
  roundEvidencePermissions,
  type RecordingRound,
  type RecordingViewer,
} from './audience';

setupRitewayBun();

const round: RecordingRound = {
  id: 'round',
  competitionType: 'ranked',
  visibility: 'public',
  hostActorId: 'host',
  completedAtMs: 100_000,
  seatedActorIds: ['aff', 'neg', 'judge'],
};
const visitor: RecordingViewer = { kind: 'visitor' };
const account = (actorId: string): RecordingViewer => ({
  kind: 'account',
  userId: `user-${actorId}`,
  actorId,
});
const nothing = {
  open: false,
  media: false,
  transcript: false,
  result: false,
};
const everything = { open: true, media: true, transcript: true, result: true };
const passed = { kind: 'open', releasedThroughMs: 200_000 } as const;

describe('roundEvidencePermissions', () => {
  test('follows the released media, never the clock', () => {
    assert({
      given: 'a ranked Round whose watermark has not passed its end',
      should: 'not admit the audience at all',
      actual: roundEvidencePermissions(
        round,
        { kind: 'open', releasedThroughMs: 100_000 },
        visitor,
      ),
      expected: nothing,
    });
    assert({
      given: 'a Broadcast that has released nothing',
      should: 'not admit the audience',
      actual: roundEvidencePermissions(
        round,
        { kind: 'open', releasedThroughMs: null },
        account('stranger'),
      ),
      expected: nothing,
    });
    assert({
      given: 'a ranked Round past the watermark',
      should: 'give a visitor the video, captions and result',
      actual: roundEvidencePermissions(round, passed, visitor),
      expected: everything,
    });
    assert({
      given: 'a seat before the watermark',
      should: 'not hold its own evidence back',
      actual: roundEvidencePermissions(
        round,
        { kind: 'open', releasedThroughMs: null },
        account('aff'),
      ),
      expected: everything,
    });
  });

  test('enforces each permission independently', () => {
    const casual = { ...round, competitionType: 'casual' } as const;
    assert({
      given: 'a public casual Round and a stranger',
      should: 'allow the video but neither transcript nor result',
      actual: roundEvidencePermissions(casual, { kind: 'none' }, visitor),
      expected: { open: true, media: true, transcript: false, result: false },
    });
    assert({
      given: 'a seatless host',
      should: 'allow the video and result but not a transcript of others',
      actual: roundEvidencePermissions(
        casual,
        { kind: 'none' },
        account('host'),
      ),
      expected: { open: true, media: true, transcript: false, result: true },
    });
    assert({
      given: 'a private Round and a stranger',
      should: 'answer as if it did not exist',
      actual: roundEvidencePermissions(
        { ...casual, visibility: 'private' },
        { kind: 'none' },
        account('stranger'),
      ),
      expected: nothing,
    });
    assert({
      given: 'an unlisted Round and someone with the link',
      should: 'admit them',
      actual: roundEvidencePermissions(
        { ...casual, visibility: 'unlisted' },
        { kind: 'none' },
        visitor,
      ).media,
      expected: true,
    });
    assert({
      given: 'a Round still running',
      should: 'give anyone nothing here',
      actual: roundEvidencePermissions(
        { ...round, completedAtMs: null },
        { kind: 'none' },
        account('aff'),
      ),
      expected: nothing,
    });
  });
});

describe('recordingMediaState', () => {
  test('never offers playback it does not have', () => {
    assert({
      given: 'every status',
      should: 'offer playback only when ready and hide why it was taken down',
      actual: [
        null,
        'requested',
        'capturing',
        'processing',
        'ready',
        'failed',
        'taken_down',
        'removing',
        'removed',
      ].map((status) => recordingMediaState(status as never)),
      expected: [
        'not_recorded',
        'processing',
        'processing',
        'processing',
        'watch',
        'failed',
        'removed',
        'removed',
        'removed',
      ],
    });
  });
});

describe('mayDownload', () => {
  const allowed = {
    viewer: account('stranger'),
    permissions: everything,
    status: 'ready',
    subscribed: true,
  } as const;
  test('needs the entitlement, the right to watch and ready media', () => {
    assert({
      given: 'a subscriber who may watch a ready Recording',
      should: 'allow',
      actual: mayDownload(allowed),
      expected: true,
    });
    assert({
      given: 'no entitlement',
      should: 'refuse',
      actual: mayDownload({ ...allowed, subscribed: false }),
      expected: false,
    });
    assert({
      given: 'a subscriber who may not watch it',
      should: 'refuse',
      actual: mayDownload({ ...allowed, permissions: nothing }),
      expected: false,
    });
    assert({
      given: 'a Recording taken down',
      should: 'refuse',
      actual: mayDownload({ ...allowed, status: 'taken_down' }),
      expected: false,
    });
    assert({
      given: 'a visitor',
      should: 'refuse',
      actual: mayDownload({ ...allowed, viewer: visitor }),
      expected: false,
    });
  });
});

describe('mayRequestRemoval', () => {
  const casual = {
    recordingClass: 'casual',
    round,
    viewer: account('neg'),
    status: 'ready',
  } as const;
  test('any participant on casual, nobody on ranked', () => {
    assert({
      given: 'a judge or debater on a casual Recording',
      should: 'allow',
      actual: [
        mayRequestRemoval(casual),
        mayRequestRemoval({ ...casual, viewer: account('judge') }),
      ],
      expected: [true, true],
    });
    assert({
      given: 'a debater on a ranked Recording',
      should: 'refuse',
      actual: mayRequestRemoval({ ...casual, recordingClass: 'ranked' }),
      expected: false,
    });
    assert({
      given: 'a seatless host or a stranger',
      should: 'refuse',
      actual: [
        mayRequestRemoval({ ...casual, viewer: account('host') }),
        mayRequestRemoval({ ...casual, viewer: visitor }),
      ],
      expected: [false, false],
    });
    assert({
      given: 'nothing left to remove',
      should: 'not offer it',
      actual: mayRequestRemoval({ ...casual, status: 'removing' }),
      expected: false,
    });
  });
});
