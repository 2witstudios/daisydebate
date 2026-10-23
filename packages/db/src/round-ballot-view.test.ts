import { ballotCategories } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ballotReadView, ownJudgeSeat } from './round-ballot-view';

setupRitewayBun();

type Row = Parameters<typeof ballotReadView>[0]['rows'][number];
type Frozen = NonNullable<Parameters<typeof ballotReadView>[0]['frozen']>;
const scores = {
  affirmative: Object.fromEntries(ballotCategories.map((key) => [key, 4])),
  negative: Object.fromEntries(ballotCategories.map((key) => [key, 3])),
};
const row = (judgeParticipantId: string, citations: unknown = null) =>
  ({
    id: `ballot-${judgeParticipantId}`,
    judgeParticipantId,
    roundId: 'round',
    freezeRevision: 1,
    rubricVersion: 'speaker-10@1',
    winner: 'affirmative',
    scores,
    reason: 'Clearer weighing.',
    feedback: null,
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
    rows,
    frozen,
  });
  const done = ballotReadView({
    status: 'completed',
    ownSeatId: undefined,
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
          { status: 'submitted', ballot: body },
          { status: 'submitted', ballot: body },
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
