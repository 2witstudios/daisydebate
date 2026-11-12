import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundBallotRead, RoundBallotReceipt } from '@daisy/protocol';
import {
  asActive,
  view,
  judge,
  aff,
  neg,
} from '../../ui/debate-room/live-round.test-support';
import { formValues } from '../forms/form-state';
import { ballotFormFixture } from './ballot-form.test-support';
import type { RoundBallotFormState } from './form';
import { ballotDisplay } from './presentation';

setupRitewayBun();

const open: RoundBallotRead = {
  round: {
    ...asActive(view),
    participants: [
      { ...aff, label: 'Maya Singh' },
      { ...neg, label: 'Daniel Kim' },
      judge,
    ],
  },
  own: { participantId: judge.id, ballot: null, freezeRevision: null },
  freeze: {
    revision: 1,
    frontier: 0,
    frozenAt: '2026-10-22T00:00:00.000Z',
    completeness: 'incomplete',
    utterances: [],
  },
  ballots: [],
  transcript: null,
};
const receipt: RoundBallotReceipt = {
  commandId: 'c'.repeat(24),
  roundId: view.id,
  ballotId: 'b'.repeat(24),
  judgeParticipantId: judge.id,
  freezeRevision: 1,
  resultingVersion: 4,
  outcome: 'affirmative',
};

const values = formValues(ballotFormFixture());

test('a ballot answer cannot hold a receipt and a lost acknowledgement at once', () => {
  const contradictory: RoundBallotFormState = {
    kind: 'unacknowledged',
    values,
    // @ts-expect-error a receipt exists only on the recorded answer
    receipt,
  };
  assert({
    given:
      'an unacknowledged answer forced to carry a receipt past the compiler',
    should: 'be read by its kind alone',
    actual: ballotDisplay(open, contradictory),
    expected: 'retry',
  });
});

test('each ballot answer has one display over an open ballot', () => {
  const answers: Record<RoundBallotFormState['kind'], RoundBallotFormState> = {
    idle: { kind: 'idle', values: {} },
    refused: { kind: 'refused', values, error: 'Confirm the low-point win.' },
    recorded: { kind: 'recorded', receipt },
    unacknowledged: { kind: 'unacknowledged', values },
    moved: { kind: 'moved', next: `/judge/ballot/${view.id}` },
  };
  assert({
    given: 'every kind of ballot answer while the persisted ballot is open',
    should:
      'retry only the lost answer, show recorded only for the receipt, and otherwise show what the Round persists',
    actual: Object.fromEntries(
      Object.entries(answers).map(([kind, answer]) => [
        kind,
        ballotDisplay(open, answer),
      ]),
    ),
    expected: {
      idle: 'open',
      refused: 'open',
      recorded: 'recorded',
      unacknowledged: 'retry',
      moved: 'open',
    },
  });
});

test('a lost answer that cannot be posted again falls back to the persisted Round', () => {
  assert({
    given:
      'an unacknowledged answer whose fields are not a whole ballot, over an open ballot and over a frozen-less Round',
    should: 'offer no retry and show what the Round persists',
    actual: [
      ballotDisplay(open, { kind: 'unacknowledged', values: {} }),
      ballotDisplay(
        { ...open, freeze: null },
        { kind: 'unacknowledged', values: {} },
      ),
    ],
    expected: ['open', 'waiting'],
  });
});
