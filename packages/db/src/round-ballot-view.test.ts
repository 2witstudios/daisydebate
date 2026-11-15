import {
  ballotCategories,
  daisyBallotDefinitions,
  daisyWinnerBallot,
  daisyBallotSource,
} from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ballotReadView, ownJudgeSeat } from './round-ballot-view';

setupRitewayBun();

type Row = Parameters<typeof ballotReadView>[0]['rows'][number];
type Frozen = NonNullable<Parameters<typeof ballotReadView>[0]['frozen']>;
const scores = {
  affirmative: Object.fromEntries(ballotCategories.map((key) => [key, 4])),
  negative: Object.fromEntries(ballotCategories.map((key) => [key, 3])),
};
const row = (
  judgeParticipantId: string,
  citations: unknown = null,
  feedback: unknown = null,
) =>
  ({
    id: `ballot-${judgeParticipantId}`,
    judgeParticipantId,
    roundId: 'round',
    freezeRevision: 1,
    rubricVersion: 'speaker-10@2',
    decision: 'win',
    winner: 'affirmative',
    ranking: null,
    speakerRanks: null,
    ballotDefinitionId: null,
    ballotDefinitionVersion: null,
    scores,
    reason: 'Clearer weighing.',
    feedback,
    citations,
  }) as unknown as Row;
/** The Round's frozen definition and subjects every view reads ballots by. */
const judged = {
  definition: daisyWinnerBallot,
  source: daisyBallotSource(daisyWinnerBallot),
  subjects: {
    sides: ['affirmative', 'negative'],
    speakers: ['aff', 'neg'],
    segments: ['AC', 'NC'],
  },
};
const body = {
  rubricVersion: 'speaker-10@2',
  winner: 'affirmative',
  scores,
  reason: 'Clearer weighing.',
  feedback: {},
};
const frozen = {
  revision: 1,
  frontier: 6,
  frozenAt: '2026-10-22T12:00:00.000Z',
  completeness: 'complete',
  utterances: [],
  roundId: 'round',
} as unknown as Frozen;

test('only a human judge seated in the Round has an own seat', () => {
  const participants = [
    {
      id: 'aff',
      actorId: 'a',
      seat: { kind: 'side', side: 'affirmative', slot: 0 } as const,
      kind: 'human',
    },
    {
      id: 'judge-h',
      actorId: 'h',
      seat: { kind: 'judge', slot: 0 } as const,
      kind: 'human',
    },
    {
      id: 'judge-b',
      actorId: 'b',
      seat: { kind: 'judge', slot: 1 } as const,
      kind: 'bot',
    },
  ];
  assert({
    given: 'a debater, a human judge, a bot judge and a spectator',
    should: 'find a seat only for the human judge',
    actual: ['a', 'h', 'b', 'x'].map(
      (actorId) => ownJudgeSeat(participants, actorId)?.id ?? null,
    ),
    expected: [null, 'judge-h', null, null],
  });
});

test('judges see their own ballot and the frozen input, others’ only after completion', () => {
  const rows = [row('judge-h'), row('judge-b')];
  const open = ballotReadView({
    audience: { kind: 'ordinary' },
    status: 'active',
    ownSeatId: 'judge-h',
    viewerSubject: undefined,
    aiJudgeSeatIds: new Set(['judge-b']),
    ...judged,
    rows,
    frozen,
  });
  const done = ballotReadView({
    audience: { kind: 'ordinary' },
    status: 'completed',
    ownSeatId: undefined,
    viewerSubject: undefined,
    aiJudgeSeatIds: new Set(['judge-b']),
    ...judged,
    rows,
    frozen: null,
  });
  assert({
    given:
      'a judge reading an active Round, then a spectator reading it completed',
    should:
      'show the judge only their own ballot and frozen input, and everyone all ballots once completed',
    actual: { open, done },
    expected: {
      open: {
        own: {
          participantId: 'judge-h',
          ballot: body,
          freezeRevision: 1,
        },
        freeze: {
          revision: 1,
          frontier: 6,
          frozenAt: '2026-10-22T12:00:00.000Z',
          completeness: 'complete',
          utterances: [],
        },
        ballots: [],
      },
      done: {
        own: null,
        freeze: null,
        ballots: [
          { judge: 'human', ballot: body, reportableFeedbackId: null },
          { judge: 'ai', ballot: body, reportableFeedbackId: null },
        ],
      },
    },
  });
});

test('a judge who has not submitted sees an empty own ballot', () => {
  assert({
    given: 'a seated judge with no stored ballot',
    should: 'report the seat with no ballot or revision',
    actual: ballotReadView({
      audience: { kind: 'ordinary' },
      status: 'active',
      ownSeatId: 'judge-h',
      viewerSubject: undefined,
      aiJudgeSeatIds: new Set(),
      ...judged,
      rows: [row('judge-b')],
      frozen,
    }).own,
    expected: {
      participantId: 'judge-h',
      ballot: null,
      freezeRevision: null,
    },
  });
});

test('a released ballot carries feedback only for the reader’s own side', () => {
  const feedback = {
    affirmative: 'Weigh earlier.',
    negative: 'Answer the turn.',
  };
  const view = (viewerSubject: 'affirmative' | 'negative' | undefined) =>
    ballotReadView({
      audience: { kind: 'ordinary' },
      status: 'completed',
      ownSeatId: undefined,
      viewerSubject,
      aiJudgeSeatIds: new Set(),
      ...judged,
      rows: [row('judge-h', null, feedback)],
      frozen: null,
    }).ballots.map((entry) => entry.ballot.feedback);
  assert({
    given: 'a ballot with feedback for both sides',
    should:
      'give each debater only their own feedback and a spectator or judge none',
    actual: {
      affirmative: view('affirmative'),
      negative: view('negative'),
      other: view(undefined),
    },
    expected: {
      affirmative: [{ affirmative: 'Weigh earlier.' }],
      negative: [{ negative: 'Answer the turn.' }],
      other: [{}],
    },
  });
});

test('a released speaker ranking carries feedback only for the reading speaker', () => {
  const ranked = {
    ...row('judge-h'),
    rubricVersion: 'rank-speakers@1',
    decision: 'ranking',
    winner: null,
    ranking: [['s1'], ['s2'], ['s3']],
    scores: null,
    feedback: { s1: 'Lead with impact.', s2: 'Signpost the rebuttal.' },
  } as unknown as Row;
  const view = (viewerSubject: string | undefined) =>
    ballotReadView({
      audience: { kind: 'ordinary' },
      status: 'completed',
      ownSeatId: undefined,
      viewerSubject,
      aiJudgeSeatIds: new Set(),
      definition: daisyBallotDefinitions['rank-speakers@1'],
      source: daisyBallotSource(daisyBallotDefinitions['rank-speakers@1']),
      subjects: { sides: [], speakers: ['s1', 's2', 's3'], segments: [] },
      rows: [ranked],
      frozen: null,
    }).ballots.map((entry) => ({
      feedback: entry.ballot.feedback,
      reportable: entry.reportableFeedbackId,
    }));
  assert({
    given: 'a speaker ranking with feedback for two of three speakers',
    should:
      'give each speaker only their own feedback, reportable, and a speaker without feedback none',
    actual: [view('s1'), view('s2'), view('s3')],
    expected: [
      [{ feedback: { s1: 'Lead with impact.' }, reportable: 'ballot-judge-h' }],
      [
        {
          feedback: { s2: 'Signpost the rebuttal.' },
          reportable: 'ballot-judge-h',
        },
      ],
      [{ feedback: {}, reportable: null }],
    ],
  });
});
