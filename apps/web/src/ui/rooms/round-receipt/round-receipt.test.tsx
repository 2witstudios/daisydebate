import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RoundReceipt, type RoundReceiptView } from './round-receipt';

setupRitewayBun();

const scheduled: RoundReceiptView = {
  id: 'round-owned',
  roomId: 'room-owned',
  status: 'scheduled',
  outcome: null,
  unjudgedRuling: null,
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
      html.includes('Not started'),
      html.includes('0:45'),
      html.includes('Open floor'),
      html.includes('Affirmative 2'),
      html.includes('2:05'),
      html.includes('1:30'),
      html.indexOf('Aff reply (A2)') < html.indexOf('Neg closing (N1)'),
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
      html.includes('Closed'),
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
      html.includes('Round · Finished'),
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

test('a Round closed on an incomplete transcript says so instead of blaming the judges (DEC-208)', () => {
  const html = renderToStaticMarkup(
    <RoundReceipt
      round={{
        ...judged,
        outcome: null,
        unjudgedRuling: 'transcript-incomplete',
      }}
    />,
  );
  assert({
    given:
      'a completed AI-judged Round whose finalizer ruled the transcript incomplete',
    should:
      'say the transcript was incomplete, never that judges did not rule, a draw or a winner',
    actual: [
      html.includes('Result · Transcript incomplete'),
      html.includes('Judges did not rule'),
      html.includes('Draw'),
      html.includes('won'),
    ],
    expected: [true, false, false, false],
  });
});

test('the receipt labels the resolution and never shows a raw setting value', () => {
  const html = renderToStaticMarkup(<RoundReceipt round={scheduled} />);
  assert({
    given: 'a frozen round with prep, countdown and interaction rules',
    should: 'label the resolution and read every setting in words',
    actual: [
      html.includes('>Resolution</h2>'),
      html.includes('Settings when the round started'),
      /Disabled|>free<|>disabled<|\dm \d+s|Launch/.test(html),
      html.includes('>Off<'),
    ],
    expected: [true, true, false, true],
  });
});

test('an ended draw Round shows how its resolution was chosen, with erased lines as removed', () => {
  const html = renderToStaticMarkup(
    <RoundReceipt
      round={{
        ...scheduled,
        status: 'completed',
        resolutionAudit: {
          manifest: {
            version: 1,
            algorithm: 'daisy-draw-v1',
            roomId: 'r'.repeat(24),
            drawId: 'd'.repeat(24),
            source: { kind: 'host', count: 3 },
            drawSize: 3,
            firstStriker: 'negative',
            strikeWindowMs: 60_000,
            controllers: { affirmative: 'human', negative: 'human' },
            inputCommitment: 'b'.repeat(64),
          },
          manifestDigest: 'c'.repeat(64),
          commitment: 'e'.repeat(64),
          items: [
            { position: 0, text: 'Kept line', category: null },
            { position: 1, text: null, category: null },
            { position: 2, text: '<Frozen topic>', category: null },
          ],
          strikes: [
            {
              ordinal: 0,
              side: 'negative',
              kind: 'timeout',
              position: 1,
              at: '2026-10-12T00:01:00.000Z',
            },
            {
              ordinal: 1,
              side: 'affirmative',
              kind: 'debater',
              position: 0,
              at: '2026-10-12T00:01:30.000Z',
            },
          ],
          survivorPosition: 2,
          revealedAt: '2026-10-12T00:01:30.000Z',
          inputsErased: true,
        },
      }}
    />,
  );
  assert({
    given: 'a finished Round whose first struck line was erased',
    should:
      'list both strikes in order, the erased one as removed, and the commitment',
    actual: [
      html.includes('How the resolution was chosen'),
      html.includes(
        'Negative ran out of time; Daisy struck “A removed resolution”',
      ),
      html.includes('Affirmative struck “Kept line”'),
      html.includes('e'.repeat(64)),
    ],
    expected: [true, true, true, true],
  });
});
