import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { audienceLinkHash } from '../audience-link/audience-link';
import {
  mayDownload,
  mayRequestRemoval,
  OFFICIALS_RECORDING_RETENTION_MS,
  recordingDeletionDueMs,
  recordingMediaState,
  roundEvidencePermissions as permissionsWithLink,
  type BroadcastRelease,
  type RecordingRound,
  type RecordingViewer,
} from './audience';

setupRitewayBun();

const round: RecordingRound = {
  id: 'round',
  competitionType: 'ranked',
  visibility: 'public',
  audienceLinkHash: null,
  hostActorId: 'host',
  completedAtMs: 100_000,
  seatedActorIds: ['aff', 'neg', 'judge'],
  recordingPolicy: 'released',
  officialActorIds: ['judge'],
  youth: null,
};
const roundEvidencePermissions = (
  input: RecordingRound,
  release: BroadcastRelease,
  viewer: RecordingViewer,
) => permissionsWithLink(input, release, viewer, null, 100_000);
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
const passed = { releasedThroughMs: 200_000, stop: 'none' } as const;

describe('roundEvidencePermissions', () => {
  test('follows the audience timeline', () => {
    assert({
      given: 'a ranked Round whose watermark has not passed its end',
      should: 'not admit the audience at all',
      actual: roundEvidencePermissions(
        round,
        { releasedThroughMs: 100_000, stop: 'none' },
        visitor,
      ),
      expected: nothing,
    });
    assert({
      given: 'a Broadcast that has released nothing',
      should: 'not admit the audience',
      actual: roundEvidencePermissions(
        round,
        { releasedThroughMs: null, stop: 'none' },
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
        { releasedThroughMs: null, stop: 'none' },
        account('aff'),
      ),
      expected: everything,
    });
  });

  test('a stop withholds the media and nothing else', () => {
    assert({
      given: 'a stopped ranked Broadcast past its end, and its seat',
      should: 'withhold the video from the audience, and never from the seat',
      actual: [
        roundEvidencePermissions(
          round,
          { ...passed, stop: 'media_withheld' },
          visitor,
        ),
        roundEvidencePermissions(
          round,
          { ...passed, stop: 'media_withheld' },
          account('aff'),
        ).media,
      ],
      expected: [{ ...everything, media: false }, true],
    });
  });

  test('a feed that ended without the operator stopping it withholds nothing', () => {
    assert({
      given: 'a Broadcast whose feed a takedown ended, the Recording restored',
      should: 'let the audience watch',
      actual: roundEvidencePermissions(
        round,
        { ...passed, stop: 'feed_ended' },
        visitor,
      ).media,
      expected: true,
    });
  });

  test('enforces each permission independently', () => {
    const casual = { ...round, competitionType: 'casual' } as const;
    assert({
      given: 'a public casual Round and a stranger',
      should: 'allow the video but neither transcript nor result',
      actual: roundEvidencePermissions(casual, passed, visitor),
      expected: { open: true, media: true, transcript: false, result: false },
    });
    assert({
      given: 'a seatless host',
      should: 'allow the video and result but not a transcript of others',
      actual: roundEvidencePermissions(casual, passed, account('host')),
      expected: { open: true, media: true, transcript: false, result: true },
    });
    assert({
      given: 'a private Round and a stranger',
      should: 'answer as if it did not exist',
      actual: roundEvidencePermissions(
        { ...casual, visibility: 'private' },
        passed,
        account('stranger'),
      ),
      expected: nothing,
    });
    const link = audienceLinkHash('the-link');
    const unlisted: RecordingRound = {
      ...casual,
      visibility: 'unlisted',
      audienceLinkHash: link,
    };
    assert({
      given: 'an unlisted Round and someone with its current link',
      should: 'admit them',
      actual: permissionsWithLink(unlisted, passed, visitor, link, 100_000)
        .media,
      expected: true,
    });
    assert({
      given: 'an unlisted Round and no link',
      should: 'answer exactly as a missing Round',
      actual: permissionsWithLink(
        unlisted,
        passed,
        account('stranger'),
        null,
        100_000,
      ),
      expected: nothing,
    });
    assert({
      given: 'an unlisted Round and a replaced link',
      should: 'answer exactly as a missing Round',
      actual: permissionsWithLink(
        unlisted,
        passed,
        visitor,
        audienceLinkHash('old-link'),
        100_000,
      ),
      expected: nothing,
    });
    assert({
      given: 'an unlisted Round whose host has issued no link',
      should: 'still let its host and seats in',
      actual: [
        permissionsWithLink(
          { ...unlisted, audienceLinkHash: null },
          passed,
          account('host'),
          null,
          100_000,
        ).open,
        permissionsWithLink(
          { ...unlisted, audienceLinkHash: null },
          passed,
          account('aff'),
          null,
          100_000,
        ).open,
      ],
      expected: [true, true],
    });
    assert({
      given: 'a Round still running',
      should: 'give anyone nothing here',
      actual: roundEvidencePermissions(
        { ...round, completedAtMs: null },
        passed,
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
    reuseFenced: false,
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

describe('roundEvidencePermissions under the officials policy (TAB-6.15)', () => {
  const kept: RecordingRound = {
    ...round,
    competitionType: 'casual',
    recordingPolicy: 'officials',
  };
  const at = (nowMs: number, viewer: RecordingViewer) =>
    permissionsWithLink(kept, passed, viewer, null, nowMs);
  const due = 100_000 + OFFICIALS_RECORDING_RETENTION_MS;
  test('only the officials and the host see the video, until its deletion date', () => {
    assert({
      given: 'a judge, the host, a debater and a visitor before the date',
      should:
        'show the video to the judge and the host, the rest of the record to the debater, nothing to the visitor',
      actual: [
        at(200_000, account('judge')).media,
        at(200_000, account('host')).media,
        at(200_000, account('aff')),
        at(200_000, visitor),
      ],
      expected: [
        true,
        true,
        { open: true, media: false, transcript: true, result: true },
        nothing,
      ],
    });
    assert({
      given: 'the judge on and after the deletion date',
      should: 'no longer show the video',
      actual: [at(due - 1, account('judge')).media, at(due, account('judge'))],
      expected: [true, { ...everything, media: false }],
    });
    assert({
      given: 'a Recording released as any other',
      should: 'have no deletion date',
      actual: [recordingDeletionDueMs(round), recordingDeletionDueMs(kept)],
      expected: [null, due],
    });
  });
});

describe('a Youth Round follows Open’s rules (ADR 0161)', () => {
  const people = {
    debaters: [
      { actorId: 'aff', userId: 'user-aff', linkedAdultActorIds: ['coach'] },
      { actorId: 'neg', userId: 'user-neg', linkedAdultActorIds: ['parent'] },
    ],
  };
  const youthOf = (open: RecordingRound): RecordingRound => ({
    ...open,
    youth: people,
  });
  const youthRound = youthOf(round);
  const hash = audienceLinkHash('token');
  const viewers = {
    debater: account('aff'),
    judge: account('judge'),
    host: account('host'),
    stranger: account('stranger'),
    visitor,
  };
  const linkedAdults = { coach: account('coach'), parent: account('parent') };

  test('answers every viewer as the same Open Round does, but its linked adults', () => {
    const cases = (['ranked', 'casual'] as const).flatMap((competitionType) =>
      (['public', 'unlisted', 'private'] as const).flatMap((visibility) =>
        [null, hash].map((presented) => ({
          competitionType,
          visibility,
          presented,
        })),
      ),
    );
    const answers = (input: RecordingRound, presented: string | null) =>
      Object.values({ ...viewers, ...linkedAdults }).map((viewer) =>
        permissionsWithLink(input, passed, viewer, presented, 100_000),
      );
    const differences = cases.flatMap(
      ({ competitionType, visibility, presented }) => {
        const open: RecordingRound = {
          ...round,
          competitionType,
          visibility,
          audienceLinkHash: visibility === 'unlisted' ? hash : null,
        };
        const asOpen = answers(open, presented);
        const asYouth = answers(youthOf(open), presented);
        return Object.keys(viewers).flatMap((name, index) =>
          JSON.stringify(asOpen[index]) === JSON.stringify(asYouth[index])
            ? []
            : [
                `${competitionType} ${visibility} ${presented ? 'link' : 'no link'}: ${name}`,
              ],
        );
      },
    );
    assert({
      given:
        'a ranked and a casual Round, public, unlisted (with and without its link) and private, in either lobby',
      should:
        'give every seat, host, stranger and visitor the same permissions in both lobbies',
      actual: differences,
      expected: [],
    });
  });

  test('its linked coaches and parents see through private and unlisted', () => {
    const at = (visibility: RecordingRound['visibility']) =>
      Object.values(linkedAdults).map((viewer) =>
        roundEvidencePermissions(
          { ...youthOf({ ...round, competitionType: 'casual' }), visibility },
          passed,
          viewer,
        ),
      );
    assert({
      given:
        'a youth debater’s coach and parent on a public, an unlisted and a private casual Youth Round',
      should: 'show them everything a debater sees, whatever the Room says',
      actual: [at('public'), at('unlisted'), at('private')],
      expected: [
        [everything, everything],
        [everything, everything],
        [everything, everything],
      ],
    });
    assert({
      given: 'the same coach on an Open Round, where nobody is linked to them',
      should: 'see what any stranger sees',
      actual: roundEvidencePermissions(
        { ...round, competitionType: 'casual', visibility: 'private' },
        passed,
        account('coach'),
      ),
      expected: nothing,
    });
  });

  test('a coach who hosts their students’ Round sees it as a linked adult, not less', () => {
    const hostCoach = (policy: RecordingRound['recordingPolicy']) =>
      roundEvidencePermissions(
        {
          ...youthOf({
            ...round,
            competitionType: 'casual',
            visibility: 'private',
            hostActorId: 'coach',
            recordingPolicy: policy,
          }),
        },
        passed,
        account('coach'),
      );
    assert({
      given:
        'a private casual Youth Round hosted by a youth debater’s coach, recorded for everyone and for its officials',
      should:
        'show the host-coach everything, the video included, as both host and linked adult',
      actual: [hostCoach('released'), hostCoach('officials')],
      expected: [everything, everything],
    });
    assert({
      given: 'the same host-coach after an operator withheld the Broadcast',
      should: 'keep the host’s video, as any host keeps it',
      actual: roundEvidencePermissions(
        youthOf({
          ...round,
          competitionType: 'casual',
          visibility: 'private',
          hostActorId: 'coach',
        }),
        { ...passed, stop: 'media_withheld' },
        account('coach'),
      ),
      expected: everything,
    });
  });

  test('an operator’s stop withholds the video from a linked adult, as from the audience', () => {
    const withheld: BroadcastRelease = { ...passed, stop: 'media_withheld' };
    assert({
      given:
        'a Youth Round whose Broadcast an operator withheld, read by a debater, a coach and a stranger',
      should: 'keep the video for its seats only',
      actual: ['aff', 'coach', 'stranger'].map((id) =>
        roundEvidencePermissions(youthRound, withheld, account(id)),
      ),
      expected: [
        everything,
        { ...everything, media: false },
        { ...everything, media: false },
      ],
    });
  });

  test('a casual one kept for its officials shows a linked adult the record, never the video', () => {
    const officials: RecordingRound = {
      ...youthRound,
      competitionType: 'casual',
      recordingPolicy: 'officials',
    };
    assert({
      given:
        'a casual Youth Round recorded for its officials, read by the judge, a debater, a coach and a stranger',
      should:
        'show the judge the video, the coach the record only, and the stranger nothing',
      actual: ['judge', 'aff', 'coach', 'stranger'].map((id) =>
        roundEvidencePermissions(officials, passed, account(id)),
      ),
      expected: [
        everything,
        { ...everything, media: false },
        { ...everything, media: false },
        nothing,
      ],
    });
  });

  test('nothing before it ends, linked adults included', () => {
    assert({
      given: 'a coach on a Youth Round still running',
      should: 'see nothing of its Recording yet',
      actual: roundEvidencePermissions(
        { ...youthRound, completedAtMs: null },
        passed,
        account('coach'),
      ),
      expected: nothing,
    });
  });

  test('is downloaded only past the reuse fence, and is taken down by its youth', () => {
    const download = (reuseFenced: boolean) =>
      mayDownload({
        reuseFenced,
        viewer: account('stranger'),
        permissions: everything,
        status: 'ready',
        subscribed: true,
      });
    assert({
      given:
        'a subscriber who may watch a ready Recording, fenced against reuse and not',
      should: 'offer the download only past the fence',
      actual: [download(true), download(false)],
      expected: [false, true],
    });
    assert({
      given:
        'a ranked Youth Recording, asked by a debater, a parent and the judge',
      should: 'let the debater and the parent take it down',
      actual: ['aff', 'parent', 'judge'].map((actorId) =>
        mayRequestRemoval({
          recordingClass: 'ranked',
          round: youthRound,
          viewer: account(actorId),
          status: 'ready',
        }),
      ),
      expected: [true, true, false],
    });
  });
});
