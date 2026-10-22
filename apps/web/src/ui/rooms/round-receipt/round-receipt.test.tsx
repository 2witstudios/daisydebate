import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RoundReceipt, type RoundReceiptView } from './round-receipt';

setupRitewayBun();

const scheduled: RoundReceiptView = {
  id: 'round-owned',
  roomId: 'room-owned',
  status: 'scheduled',
  outcome: null,
  topic: '<Frozen topic>',
  config: { preRoundPrep: { enabled: true, durationMs: 45000 } },
  rules: {
    countdownMs: 2000,
    inRoundPrep: null,
    interaction: {
      crossExMode: 'free',
      yield: null,
      interruptions: null,
    },
    segments: [
      {
        key: 'A2',
        label: 'Aff reply',
        type: 'speech',
        side: 'affirmative',
        slot: 1,
        durationMs: 125000,
      },
      {
        key: 'N1',
        label: 'Neg closing',
        type: 'speech',
        side: 'negative',
        slot: 0,
        durationMs: 90000,
      },
    ],
  },
  participants: [
    {
      id: 'seat-a',
      actorId: 'actor-a',
      kind: 'human',
      label: 'Alice',
      role: 'affirmative',
      slot: 1,
    },
    {
      id: 'seat-j',
      actorId: 'actor-j',
      kind: 'bot',
      label: 'Judge Sage',
      role: 'judge',
      slot: 0,
    },
  ],
};

test('persisted scheduled Round renders the frozen asymmetric schedule and cast', () => {
  const html = renderToStaticMarkup(<RoundReceipt round={scheduled} />);
  assert({
    given:
      'a scheduled Round with unequal frozen speech lengths and an AI judge',
    should:
      'show its real receipt, ordered slots and exact durations without implying media or a ballot exists',
    actual: [
      html.includes('&lt;Frozen topic&gt;'),
      html.includes('Scheduled'),
      html.includes('0m 45s'),
      html.includes('free'),
      html.includes('Affirmative 2'),
      html.includes('2m 5s'),
      html.includes('1m 30s'),
      html.indexOf('Aff reply') < html.indexOf('Neg closing'),
      html.includes('Judge Sage'),
      html.includes('AI'),
      html.includes('/rooms/room-owned'),
      html.includes('Media is not available yet.'),
      html.includes('Result'),
    ],
    expected: [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
    ],
  });
});

const judged: RoundReceiptView = {
  ...scheduled,
  status: 'completed',
  outcome: 'negative',
  participants: [
    ...scheduled.participants.filter((p) => p.role !== 'judge'),
    {
      id: 'seat-h',
      actorId: 'actor-h',
      kind: 'human',
      label: 'Riley Judge',
      role: 'judge',
      slot: 0,
    },
  ],
};

test('a completed zero-judge Round presents an unjudged result without inventing a winner', () => {
  const html = renderToStaticMarkup(
    <RoundReceipt
      round={{
        ...scheduled,
        status: 'completed',
        outcome: null,
        participants: scheduled.participants.filter((p) => p.role !== 'judge'),
      }}
    />,
  );
  assert({
    given: 'the shared completed Round with null outcome',
    should: 'label its unjudged result truthfully in native HTML',
    actual: [
      html.includes('Result · Unjudged'),
      html.includes('Draw'),
      html.includes('won'),
      html.includes('Abandoned'),
    ],
    expected: [true, false, false, false],
  });
});

test('a judged Round hands its result to the receipt', () => {
  const html = renderToStaticMarkup(<RoundReceipt round={judged} />);
  assert({
    given: 'a Round the human judge’s ballot completed for the negative',
    should:
      'show it completed with the result, and the judge seat without the judge’s name',
    actual: [
      html.includes('Round · Completed'),
      html.includes('Negative won'),
      html.includes('Judge 1'),
      html.includes('Riley'),
    ],
    expected: [true, true, true, false],
  });
});

test('a judged Round whose judges did not rule by the deadline says so (DEC-201)', () => {
  const html = renderToStaticMarkup(
    <RoundReceipt round={{ ...judged, outcome: null }} />,
  );
  assert({
    given: 'a completed Round with judge seats and no outcome',
    should: 'say the judges did not rule, never Unjudged, a draw or a winner',
    actual: [
      html.includes('Result · Judges did not rule'),
      html.includes('Unjudged'),
      html.includes('Draw'),
      html.includes('won'),
    ],
    expected: [true, false, false, false],
  });
});
