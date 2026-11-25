import { instantMs } from '@daisy/clock';
import { twoSides } from '@daisy/protocol/seats';
import { type RecordingLifecycle } from '@daisy/protocol/recording';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { BroadcastRelease, RecordingViewer } from './audience';
import {
  account,
  at,
  nowMs,
  ready,
  record,
  visitor,
} from './fixture.test-support';
import {
  openRecordingHistory,
  type HistoryInputs,
  type HistoryRound,
} from './history';
import type { RecordingJobState } from '@daisy/protocol/recording-processing';

setupRitewayBun();

const round: HistoryRound = {
  id: 'round',
  competitionType: 'ranked',
  visibility: 'public',
  audienceLinkHash: null,
  hostActorId: 'host',
  completedAtMs: nowMs,
  seatedActorIds: ['aff', 'neg'],
  recordingPolicy: 'released',
  officialActorIds: [],
  youth: null,
  title: 'Semifinal',
  resolution: 'Resolved: x',
  sides: twoSides,
  outcome: { kind: 'winner', side: 'negative' },
  ladder: { style: 'freestyle', division: 'open' },
  debaters: [
    {
      roundParticipantId: 'p-aff',
      actorId: 'aff',
      seat: { kind: 'side', side: 'affirmative', slot: 0 },
      label: 'ada',
    },
    {
      roundParticipantId: 'p-neg',
      actorId: 'neg',
      seat: { kind: 'side', side: 'negative', slot: 0 },
      label: null,
    },
  ],
};
const transcript = {
  revision: 7,
  completeness: 'complete',
  gaps: [],
  utterances: [
    {
      id: 'u1',
      roundParticipantId: 'p-aff',
      text: 'First point',
      complete: true,
    },
    {
      id: 'u2',
      roundParticipantId: 'p-neg',
      text: 'Rebuttal',
      complete: false,
    },
  ],
} as const;
const ballots = [
  {
    winner: 'negative',
    reason: 'Better evidence',
    scores: {
      affirmative: { argument: 3, delivery: 2 },
      negative: { argument: 4, delivery: 4 },
    },
  },
];

const open = (
  over: {
    round?: Partial<HistoryRound>;
    release?: BroadcastRelease;
    lifecycle?: RecordingLifecycle | null;
    job?: RecordingJobState | null;
    nowMs?: number;
    recordingClass?: 'ranked' | 'casual';
    subscribed?: boolean;
    capture?: HistoryInputs['holdsCasualCapture'];
    transcript?: HistoryInputs['readTranscript'];
    viewer?: RecordingViewer;
    q?: string;
    reuseFenced?: boolean;
    readReuseFenced?: HistoryInputs['readReuseFenced'];
  } = {},
) => {
  const calls: string[] = [];
  const inputs: HistoryInputs = {
    readHistoryRound: async () => ({ ...round, ...over.round }),
    readBroadcastRelease: async () =>
      over.release ?? {
        releasedThroughMs: Number.MAX_SAFE_INTEGER,
        stop: 'none',
      },
    readTranscript:
      over.transcript ??
      (async () => {
        calls.push('transcript');
        return transcript;
      }),
    readBallots: async () => {
      calls.push('ballots');
      return ballots;
    },
    holdsRecordingDownload: async () => over.subscribed ?? false,
    holdsCasualCapture: over.capture ?? (async () => false),
    readReuseFenced:
      over.readReuseFenced ?? (async () => over.reuseFenced ?? false),
    readJobState: async () => over.job ?? null,
    nowMs: () => over.nowMs ?? instantMs(at),
    findRecordingByRound: async () =>
      over.lifecycle === null
        ? null
        : record({
            class: over.recordingClass ?? 'ranked',
            lifecycle: over.lifecycle ?? ready,
          }),
  };
  return openRecordingHistory(inputs, {
    presentedLinkHash: null,
    roundId: 'round',
    viewer: over.viewer ?? visitor,
    q: over.q ?? '',
  }).then((screen) => ({ screen, calls }));
};

const history = async (over: Parameters<typeof open>[0] = {}) => {
  const { screen } = await open(over);
  if (screen.kind !== 'history') throw new Error('expected a history screen');
  return screen;
};

describe('the report target', () => {
  test('names the Recording, or its Round when there is none', async () => {
    const recorded = await history({});
    assert({
      given: 'a Round with a Recording',
      should: 'report the Recording',
      actual: [recorded.reportTarget.targetKind, recorded.reportTarget.label],
      expected: ['recording', 'Report this recording'],
    });
    assert({
      given: 'a Round that was never recorded',
      should: 'report the Round',
      actual: (await history({ lifecycle: null })).reportTarget,
      expected: {
        targetKind: 'round',
        targetId: round.id,
        label: 'Report this round',
      },
    });
  });
});

describe('media state', () => {
  test('presents each state and never fabricates playback', async () => {
    const cases: [RecordingLifecycle | null, string][] = [
      [ready, 'watch'],
      [{ status: 'requested' }, 'processing'],
      [{ status: 'failed', reason: 'capture_failed', failedAt: at }, 'failed'],
      [null, 'not_recorded'],
      [{ status: 'removing', cause: 'moderation', requestedAt: at }, 'removed'],
      [{ status: 'taken_down', takenDownAt: at, held: ready }, 'removed'],
    ];
    for (const [lifecycle, state] of cases) {
      const { media } = await history({ lifecycle });
      assert({
        given: `a Recording ${lifecycle?.status ?? 'that does not exist'}`,
        should: `show ${state} and offer playback only when ready`,
        actual: [media.state, media.state === 'watch' && media.playlistHref],
        expected: [
          state,
          state === 'watch' && '/api/recordings/rec/playback/master.m3u8',
        ],
      });
    }
  });
});

describe('coverage of a stored Recording', () => {
  test('shows the stored gaps as stated: what was lost and what was kept private', async () => {
    const { media } = await history({
      lifecycle: {
        ...ready,
        media: {
          ...ready.media,
          gaps: [
            { startMs: 0, endMs: 5000, reason: 'private_phase' },
            { startMs: 20_015, endMs: 31_500, reason: 'between_speeches' },
            { startMs: 40_000, endMs: 45_000, reason: 'capture_restart' },
          ],
        },
      },
    });
    assert({
      given: 'a Recording verified with a prep, a turnover and a restart',
      should:
        'list the restart as lost, the prep as private, and the turnover nowhere',
      actual: media.state === 'watch' && [media.lost, media.keptPrivate],
      expected: [
        [{ startMs: 40_000, endMs: 45_000, reason: 'capture_restart' }],
        [{ startMs: 0, endMs: 5000, reason: 'private_phase' }],
      ],
    });
  });
});

describe('a Broadcast stopped before the Round ended', () => {
  test('withholds the video while the rest of the record stays open', async () => {
    const { media, downloadHref } = await history({
      subscribed: true,
      viewer: { kind: 'account', userId: 'u', actorId: 'stranger' },
      release: {
        releasedThroughMs: Number.MAX_SAFE_INTEGER,
        stop: 'media_withheld',
      },
    });
    assert({
      given: 'a ready Recording of a stopped Broadcast',
      should: 'offer neither playback nor a download',
      actual: [media.state, downloadHref],
      expected: ['withheld', null],
    });
  });
});

describe('transcript without video', () => {
  test('offers the text history with turn order and honest coverage', async () => {
    const { transcript: panel, media } = await history({ lifecycle: null });
    assert({
      given: 'a ranked Round with a transcript and no Recording',
      should: 'offer the text in actual order with its revision',
      actual: [
        media.state,
        panel?.revision,
        panel?.coverageNote,
        panel?.rows.map((row) => [row.turn, row.speaker, row.partial]),
      ],
      expected: [
        'not_recorded',
        7,
        null,
        [
          [1, '@ada', false],
          [2, 'Negative', true],
        ],
      ],
    });
    const partial = await history({
      lifecycle: null,
      transcript: async () => ({
        ...transcript,
        completeness: 'incomplete',
        gaps: [{}, {}],
      }),
    });
    assert({
      given: 'a transcript with gaps',
      should: 'say so plainly',
      actual: partial.transcript?.coverageNote,
      expected: 'This transcript is partial: 2 stretches were not captured.',
    });
    const searched = await history({ lifecycle: null, q: 'rebut' });
    assert({
      given: 'a search',
      should: 'keep each match on its real turn',
      actual: searched.transcript?.rows.map((row) => row.turn),
      expected: [2],
    });
  });
});

describe('permissions', () => {
  test('hold independently, and nothing unpermitted is read', async () => {
    const casual = await open({
      round: { competitionType: 'casual' },
      recordingClass: 'casual',
    });
    assert({
      given: 'a stranger on a public casual Recording',
      should: 'not even read its transcript or ballots',
      actual: [
        casual.calls,
        casual.screen.kind === 'history' && casual.screen.transcript,
        casual.screen.kind === 'history' && casual.screen.result,
      ],
      expected: [[], null, null],
    });
    const seat = await history({
      round: { competitionType: 'casual' },
      recordingClass: 'casual',
      viewer: account('aff'),
    });
    assert({
      given: 'a debater on the same Recording',
      should: 'show text and result and offer removal',
      actual: [
        seat.transcript !== null,
        seat.result?.headline,
        seat.removal !== null,
      ],
      expected: [true, 'Negative wins', true],
    });
    const { screen } = await open({
      release: { releasedThroughMs: null, stop: 'none' },
    });
    assert({
      given: 'a ranked Round the watermark has not passed',
      should: 'answer as if it did not exist',
      actual: screen,
      expected: { kind: 'unavailable' },
    });
    const { screen: stranger } = await open({
      round: { competitionType: 'casual' },
      lifecycle: null,
    });
    assert({
      given: 'a public casual Round with no Recording',
      should: 'offer a stranger nothing',
      actual: stranger,
      expected: { kind: 'unavailable' },
    });
  });

  test('ties are null and judges appear by number', async () => {
    const tie = await history({ round: { outcome: null } });
    assert({
      given: 'no winner',
      should: 'say so and never call it a draw',
      actual: tie.result?.headline,
      expected: 'No winner',
    });
    assert({
      given: 'a released ballot',
      should: 'show winner, scores and reason under a number',
      actual: tie.result?.ballots,
      expected: [
        {
          title: 'Judge 1',
          winner: 'Negative',
          scores: 'Affirmative 5, Negative 8',
          reason: 'Better evidence',
        },
      ],
    });
  });

  test('download follows the entitlement and removal the class', async () => {
    const free = await history({ viewer: account('stranger') });
    const paid = await history({
      viewer: account('stranger'),
      subscribed: true,
    });
    const rankedSeat = await history({ viewer: account('aff') });
    assert({
      given: 'a member, a subscriber and a ranked debater',
      should: 'offer download only to the subscriber and removal to nobody',
      actual: [free.downloadHref, paid.downloadHref, rankedSeat.removal],
      expected: [null, '/api/recordings/rec/download', null],
    });
  });
});

describe('after moderation hides a Recording', () => {
  const ranked = { competitionType: 'ranked' } as const;
  const hidden: RecordingLifecycle = {
    status: 'taken_down',
    takenDownAt: at,
    reason: 'policy_violation',
    held: null,
  };
  const screen = async (
    viewer: RecordingViewer,
    lifecycle: RecordingLifecycle,
  ) => {
    const shown = await history({ round: ranked, lifecycle, viewer });
    return shown.transcript !== null;
  };

  test('the audience keeps the result and loses the ballots', async () => {
    const shown = await history({
      round: ranked,
      lifecycle: hidden,
      viewer: { kind: 'visitor' },
    });
    assert({
      given: 'a stranger on a ranked Round whose Recording was taken down',
      should: 'show the result panel with no ballot in it',
      actual: [shown.result !== null, shown.result?.ballots],
      expected: [true, []],
    });
  });

  test('the audience gets no transcript, on the page either', async () => {
    assert({
      given: 'a stranger on a ranked Round whose Recording was taken down',
      should: 'hide the transcript',
      actual: await screen(account('stranger'), hidden),
      expected: false,
    });
    assert({
      given: 'a visitor on the same',
      should: 'hide it too',
      actual: await screen(visitor, hidden),
      expected: false,
    });
    assert({
      given: 'a moderation removal, and a legal one',
      should: 'stay hidden after the takedown moves on',
      actual: [
        await screen(visitor, {
          status: 'removing',
          cause: 'moderation',
          requestedAt: at,
        }),
        await screen(visitor, {
          status: 'removed',
          cause: 'legal_removal',
          requestedAt: at,
          removedAt: at,
        }),
      ],
      expected: [false, false],
    });
  });

  test('a seated member keeps their record, and nothing else hides it', async () => {
    assert({
      given: 'a debater in that Round',
      should: 'still read the transcript',
      actual: await screen(account('aff'), hidden),
      expected: true,
    });
    assert({
      given: 'the audience on a ready Recording, and a failed cleanup',
      should: 'still read it: no moderator decided anything',
      actual: [
        await screen(visitor, ready),
        await screen(visitor, {
          status: 'removing',
          cause: 'failed_capture_cleanup',
          requestedAt: at,
        }),
      ],
      expected: [true, true],
    });
  });
});

test('history keeps an otherwise watchable Recording fenced after age erasure', async () => {
  const watched = await history({
    round: {
      competitionType: 'casual',
      visibility: 'private',
      ladder: null,
      youth: null,
    },
    viewer: account('aff'),
    recordingClass: 'casual',
    subscribed: true,
    readReuseFenced: async (roundId) => roundId === round.id,
  });
  assert({
    given:
      'a subscribed debater on a fenced mixed-age Round with no remaining Youth audience fact',
    should: 'show playback and withhold the download',
    actual: [watched.media.state, watched.downloadHref],
    expected: ['watch', null],
  });
});

describe('a Youth Round’s history (ADR 0161)', () => {
  const people = {
    debaters: [
      { actorId: 'aff', userId: 'u-aff', linkedAdultActorIds: ['coach'] },
      { actorId: 'neg', userId: 'u-neg', linkedAdultActorIds: [] },
    ],
  };
  const youthRound = (): Partial<HistoryRound> => ({
    ladder: { style: 'freestyle', division: 'youth' },
    youth: people,
  });
  const member = (actorId: string): RecordingViewer => ({
    kind: 'account',
    userId: `u-${actorId}`,
    actorId,
  });

  test('is open to the public as an Open Round is, and downloaded only once released', async () => {
    const fenced = await history({
      round: youthRound(),
      viewer: member('stranger'),
      subscribed: true,
      reuseFenced: true,
    });
    const released = await history({
      round: youthRound(),
      viewer: member('stranger'),
      subscribed: true,
      reuseFenced: false,
    });
    assert({
      given:
        'a subscribed stranger on a public ranked Youth Round, without and with every release',
      should:
        'show its video either way, and offer the download only once every youth debater released it',
      actual: {
        media: [fenced.media.state, released.media.state],
        download: [
          fenced.downloadHref !== null,
          released.downloadHref !== null,
        ],
        youth: fenced.youth,
      },
      expected: {
        media: ['watch', 'watch'],
        download: [false, true],
        youth: true,
      },
    });
  });

  test('a linked coach may take it down; a stranger may not', async () => {
    assert({
      given: 'a youth debater’s coach and a stranger',
      should: 'offer the takedown to the coach alone',
      actual: [
        (await history({ round: youthRound(), viewer: member('coach') }))
          .removal !== null,
        (
          await history({
            round: youthRound(),
            viewer: member('stranger'),
          })
        ).removal !== null,
      ],
      expected: [true, false],
    });
  });

  test('a failed reuse read leaves the history available without download', async () => {
    const watched = await history({
      round: youthRound(),
      viewer: member('stranger'),
      subscribed: true,
      readReuseFenced: async () => {
        throw new Error('reuse read failed');
      },
    });
    assert({
      given: 'a subscriber allowed to view whose reuse check fails',
      should: 'show the history and withhold the download',
      actual: [watched.kind, watched.downloadHref],
      expected: ['history', null],
    });
  });

  test('a private one is missing for a stranger and open to the linked coach', async () => {
    const hidden = { ...youthRound(), visibility: 'private' as const };
    assert({
      given: 'a stranger and a linked coach on a private Youth Round',
      should: 'answer missing to the stranger and show the coach its history',
      actual: [
        (await open({ round: hidden, viewer: member('stranger') })).screen.kind,
        (await open({ round: hidden, viewer: member('coach') })).screen.kind,
      ],
      expected: ['unavailable', 'history'],
    });
  });
});

describe('the page’s one Premium offer', () => {
  const casual = { competitionType: 'casual', ladder: null } as const;
  const youth = { debaters: [] } as never;
  const offer = async (over: Parameters<typeof open>[0]) => {
    const { screen } = await open(over);
    return screen.kind === 'history' ? screen.premiumOffer : 'no page';
  };

  test('an unrecorded casual Round offers recording to its own debater alone', async () => {
    const unrecorded = { round: casual, lifecycle: null } as const;
    assert({
      given:
        'a casual Round nobody recorded, opened by its debater, by a stranger, by a visitor, by a debater who holds the capture entitlement, by a debater whose entitlement read fails, as a Youth Round, the same Round ranked, and by its host',
      should:
        'offer recording only to a debater or host known to lack it; a stranger has no page at all',
      actual: [
        await offer({ ...unrecorded, viewer: account('aff') }),
        await offer({ ...unrecorded, viewer: account('stranger') }),
        await offer(unrecorded),
        await offer({
          ...unrecorded,
          viewer: account('aff'),
          capture: async () => true,
        }),
        await offer({
          ...unrecorded,
          viewer: account('aff'),
          capture: async () => Promise.reject(new Error('unavailable')),
        }),
        await offer({
          round: { ...casual, youth },
          lifecycle: null,
          viewer: account('aff'),
        }),
        await offer({ lifecycle: null, viewer: account('aff') }),
        await offer({ ...unrecorded, viewer: account('host') }),
      ],
      expected: [
        'record',
        'no page',
        'no page',
        null,
        null,
        null,
        null,
        'record',
      ],
    });
  });

  test('a video an account may watch offers its download, never beside the download itself', async () => {
    const paid = await history({
      viewer: account('stranger'),
      subscribed: true,
    });
    assert({
      given:
        'a ready public video opened by a free account, by a subscriber, by a visitor, as a Youth Round, while still processing, behind the reuse fence, and when the fence cannot be read',
      should:
        'offer the download only to the free account a subscription would let download it',
      actual: [
        await offer({ viewer: account('stranger') }),
        [paid.premiumOffer, paid.downloadHref !== null],
        await offer({}),
        await offer({ round: { youth }, viewer: account('stranger') }),
        await offer({
          viewer: account('stranger'),
          lifecycle: { status: 'requested' } as never,
        }),
        await offer({ viewer: account('stranger'), reuseFenced: true }),
        await offer({
          viewer: account('stranger'),
          readReuseFenced: async () => Promise.reject(new Error('unavailable')),
        }),
      ],
      expected: ['download', [null, true], null, null, null, null, null],
    });
  });
});
