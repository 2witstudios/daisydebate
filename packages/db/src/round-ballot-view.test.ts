import { ballotCategories } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ballotReadView, coachingFor, ownJudgeSeat } from './round-ballot-view';

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
    rubricVersion: 'speaker-10@1',
    winner: 'affirmative',
    scores,
    reason: 'Clearer weighing.',
    feedback,
    citations,
    status: 'submitted',
  }) as unknown as Row;
const body = {
  rubricVersion: 'speaker-10@1',
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
    { id: 'aff', actorId: 'a', role: 'affirmative', kind: 'human' },
    { id: 'judge-h', actorId: 'h', role: 'judge', kind: 'human' },
    { id: 'judge-b', actorId: 'b', role: 'judge', kind: 'bot' },
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
    status: 'active',
    ownSeatId: 'judge-h',
    viewerSide: undefined,
    aiJudgeSeatIds: new Set(['judge-b']),
    rows,
    frozen,
  });
  const done = ballotReadView({
    status: 'completed',
    ownSeatId: undefined,
    viewerSide: undefined,
    aiJudgeSeatIds: new Set(['judge-b']),
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
          status: 'submitted',
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
          { status: 'submitted', judge: 'human', ballot: body },
          { status: 'submitted', judge: 'ai', ballot: body },
        ],
      },
    },
  });
});

test('a judge who has not submitted sees an empty own ballot', () => {
  assert({
    given: 'a seated judge with no stored ballot',
    should: 'report the seat with no status, ballot or revision',
    actual: ballotReadView({
      status: 'active',
      ownSeatId: 'judge-h',
      viewerSide: undefined,
      aiJudgeSeatIds: new Set(),
      rows: [row('judge-b')],
      frozen,
    }).own,
    expected: {
      participantId: 'judge-h',
      status: null,
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
  const view = (viewerSide: 'affirmative' | 'negative' | undefined) =>
    ballotReadView({
      status: 'completed',
      ownSeatId: undefined,
      viewerSide,
      aiJudgeSeatIds: new Set(),
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

describe('coachingFor()', () => {
  const none = { status: null, feedback: null, eligible: true } as const;
  const coaching = (
    overrides: Partial<Parameters<typeof coachingFor>[0]> = {},
  ) =>
    coachingFor({
      status: 'completed',
      viewerSide: 'negative',
      aiJudgeSeatIds: new Set(['judge-b']),
      rows: [],
      facts: none,
      enabled: true,
      ...overrides,
    });
  test('who has coaching at all', () => {
    assert({
      given: 'a reader who did not debate, then a Round still in progress',
      should: 'have no coaching',
      actual: [
        coaching({ viewerSide: undefined }),
        coaching({ status: 'active' }),
      ],
      expected: [null, null],
    });
  });
  test('the AI judge already coached this side', () => {
    assert({
      given: 'a submitted AI ballot with feedback for the reader’s side',
      should: 'point to that ballot',
      actual: coaching({
        rows: [row('judge-b', null, { negative: 'Answer the turn.' })],
      }),
      expected: { status: 'in-ballot' },
    });
  });
  test('the coaching pass', () => {
    const feedback = { affirmative: 'A.', negative: 'Weigh the turn.' };
    assert({
      given: 'a pass that succeeded, one leased, one failed',
      should: 'show the reader’s text, pending, and unavailable',
      actual: [
        coaching({ facts: { status: 'succeeded', feedback, eligible: false } }),
        coaching({
          facts: { status: 'leased', feedback: null, eligible: true },
        }),
        coaching({
          facts: { status: 'failed', feedback: null, eligible: true },
        }),
      ],
      expected: [
        { status: 'ready', text: 'Weigh the turn.' },
        { status: 'pending' },
        { status: 'unavailable' },
      ],
    });
  });
  test('a Round with no pass yet', () => {
    assert({
      given:
        'an eligible Round with coaching on, then off, then an ineligible one',
      should: 'be pending only when the pass will run',
      actual: [
        coaching(),
        coaching({ enabled: false }),
        coaching({ facts: { ...none, eligible: false } }),
      ],
      expected: [
        { status: 'pending' },
        { status: 'unavailable' },
        { status: 'unavailable' },
      ],
    });
  });
  test('a human ballot’s feedback is not AI coaching', () => {
    assert({
      given: 'only a human judge’s feedback for the reader’s side',
      should: 'still wait for the coaching pass',
      actual: coaching({
        rows: [row('judge-h', null, { negative: 'Answer the turn.' })],
      }),
      expected: { status: 'pending' },
    });
  });
});
