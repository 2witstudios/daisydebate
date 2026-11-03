import type { RecordingLifecycle } from '@daisy/protocol';
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

setupRitewayBun();

const round: HistoryRound = {
  id: 'round',
  competitionType: 'ranked',
  visibility: 'public',
  hostActorId: 'host',
  completedAtMs: nowMs,
  seatedActorIds: ['aff', 'neg'],
  title: 'Semifinal',
  resolution: 'Resolved: x',
  outcome: 'negative',
  debaters: [
    { roundParticipantId: 'p-aff', role: 'affirmative', label: 'ada' },
    { roundParticipantId: 'p-neg', role: 'negative', label: null },
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
    recordingClass?: 'ranked' | 'casual';
    subscribed?: boolean;
    transcript?: HistoryInputs['readTranscript'];
    viewer?: RecordingViewer;
    q?: string;
  } = {},
) => {
  const calls: string[] = [];
  const inputs: HistoryInputs = {
    readHistoryRound: async () => ({ ...round, ...over.round }),
    readBroadcastRelease: async () =>
      over.release ?? {
        releasedThroughMs: Number.MAX_SAFE_INTEGER,
        stopped: false,
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
    findRecordingByRound: async () =>
      over.lifecycle === null
        ? null
        : record({
            class: over.recordingClass ?? 'ranked',
            lifecycle: over.lifecycle ?? ready,
          }),
  };
  return openRecordingHistory(inputs, {
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

describe('a Broadcast stopped before the Round ended', () => {
  test('withholds the video while the rest of the record stays open', async () => {
    const { media, downloadHref } = await history({
      subscribed: true,
      viewer: { kind: 'account', userId: 'u', actorId: 'stranger' },
      release: { releasedThroughMs: Number.MAX_SAFE_INTEGER, stopped: true },
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
      release: { releasedThroughMs: null, stopped: false },
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
