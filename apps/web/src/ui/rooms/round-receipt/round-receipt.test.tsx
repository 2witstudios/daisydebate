import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isJudgeSeat, twoSides } from '@daisy/protocol/seats';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { RoundReceipt, type RoundReceiptView } from './round-receipt';

setupRitewayBun();

const scheduled: RoundReceiptView = {
  id: 'round-owned',
  roomId: 'room-owned',
  status: 'opening',
  outcome: null,
  panelRuling: null,
  platformEnding: null,
  topic: '<Frozen topic>',
  config: { preRoundPrep: { enabled: true, durationMs: 45000 } },
  rules: {
    sides: [...twoSides],
    countdownMs: 2000,
    inRoundPrep: null,
    interaction: {
      yield: null,
      interruptions: { allowed: 'disabled' as const },
    },
    segments: [
      {
        key: 'A2',
        label: 'Aff reply',
        type: 'speech',
        speak: {
          rights: 'one',
          seat: { kind: 'side', side: 'affirmative', slot: 1 },
        },
        durationMs: 125000,
      },
      {
        key: 'N1',
        label: 'Neg closing',
        type: 'speech',
        speak: {
          rights: 'one',
          seat: { kind: 'side', side: 'negative', slot: 0 },
        },
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
      seat: { kind: 'side', side: 'affirmative', slot: 1 },
    },
    {
      id: 'seat-j',
      actorId: 'actor-j',
      kind: 'bot',
      label: 'Judge Sage',
      seat: { kind: 'judge', slot: 0 },
    },
  ],
};

test('persisted new Round renders the frozen asymmetric schedule and cast', () => {
  const view = renderAccessible(<RoundReceipt round={scheduled} />);
  const text = view.textContent();
  const speeches = view
    .within('region', 'Frozen speech schedule')
    .all('listitem')
    .map((item) => item.textContent ?? '');
  assert({
    given: 'a new Round with unequal frozen speech lengths and an AI judge',
    should:
      'show its real receipt, ordered slots and exact durations without implying media or a ballot exists',
    actual: [
      view
        .within('region', 'Resolution')
        .textContent()
        .includes('<Frozen topic>'),
      text.includes('Starting'),
      text.includes('0:45'),
      !text.includes('Open floor'),
      text.includes('Affirmative 2'),
      text.includes('2:05'),
      text.includes('1:30'),
      speeches.findIndex((speech) => speech.includes('Aff reply (A2)')) === 0 &&
        speeches[1]?.includes('Neg closing (N1)'),
      text.includes('Judge Sage'),
      text.includes('AI'),
      view.attribute('link', 'Return to room', 'href') === '/rooms/room-owned',
      text.includes('Media is not available yet.'),
      text.includes('Result'),
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
  outcome: { kind: 'winner', side: 'negative' },
  participants: [
    ...scheduled.participants.filter((p) => !isJudgeSeat(p.seat)),
    {
      id: 'seat-h',
      actorId: 'actor-h',
      kind: 'human',
      label: 'Riley Judge',
      seat: { kind: 'judge', slot: 0 },
    },
  ],
};

test('a completed zero-judge Round presents an unjudged result without inventing a winner', () => {
  const text = renderAccessible(
    <RoundReceipt
      round={{
        ...scheduled,
        status: 'completed',
        outcome: null,
        participants: scheduled.participants.filter(
          (p) => !isJudgeSeat(p.seat),
        ),
      }}
    />,
  ).textContent();
  assert({
    given: 'the shared completed Round with null outcome',
    should: 'label its unjudged result truthfully in native HTML',
    actual: [
      text.includes('Result · Unjudged'),
      text.includes('Draw'),
      text.includes('won'),
      text.includes('Closed'),
    ],
    expected: [true, false, false, false],
  });
});

test('a judged Round hands its result to the receipt', () => {
  const text = renderAccessible(<RoundReceipt round={judged} />).textContent();
  assert({
    given: 'a Round the human judge’s ballot completed for the negative',
    should:
      'show it completed with the result, and the judge seat without the judge’s name',
    actual: [
      text.includes('Round · Finished'),
      text.includes('Negative won'),
      text.includes('Judge 1'),
      text.includes('Riley'),
    ],
    expected: [true, true, true, false],
  });
});

test('a judged Round whose judges did not rule by the deadline says so (DEC-201)', () => {
  const text = renderAccessible(
    <RoundReceipt round={{ ...judged, outcome: null }} />,
  ).textContent();
  assert({
    given: 'a completed Round with judge seats and no outcome',
    should: 'say the judges did not rule, never Unjudged, a draw or a winner',
    actual: [
      text.includes('Result · Judges did not rule'),
      text.includes('Unjudged'),
      text.includes('Draw'),
      text.includes('won'),
    ],
    expected: [true, false, false, false],
  });
});

test('a Round closed on an incomplete transcript says so instead of blaming the judges (DEC-208)', () => {
  const text = renderAccessible(
    <RoundReceipt
      round={{
        ...judged,
        outcome: null,
        panelRuling: 'transcript-incomplete',
        platformEnding: null,
      }}
    />,
  ).textContent();
  assert({
    given:
      'a completed AI-judged Round whose finalizer ruled the transcript incomplete',
    should:
      'say the transcript was incomplete, never that judges did not rule, a draw or a winner',
    actual: [
      text.includes('Result · Transcript incomplete'),
      text.includes('Judges did not rule'),
      text.includes('Draw'),
      text.includes('won'),
    ],
    expected: [true, false, false, false],
  });
});

test('the receipt labels the resolution and never shows a raw setting value', () => {
  const view = renderAccessible(<RoundReceipt round={scheduled} />);
  const values = view
    .within('region', 'Frozen settings')
    .all('definition')
    .map((value) => value.textContent);
  assert({
    given: 'a frozen round with prep, countdown and interaction rules',
    should: 'label the resolution and read every setting in words',
    actual: [
      view.has('heading', 'Resolution', { level: 2 }),
      view.has('heading', 'Settings when the round started', { level: 2 }),
      /Disabled|\dm \d+s|Launch/.test(view.textContent()) ||
        values.includes('free') ||
        values.includes('disabled'),
      values.includes('Off'),
    ],
    expected: [true, true, false, true],
  });
});

/** A finished host-list draw Round whose first struck line was erased. */
const endedDrawRound = (): RoundReceiptView & {
  readonly resolutionAudit: NonNullable<RoundReceiptView['resolutionAudit']>;
} => ({
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
    textsWithheld: false,
  },
});

test('an ended draw Round shows how its resolution was chosen, with erased lines as removed', () => {
  const text = renderAccessible(
    <RoundReceipt round={endedDrawRound()} />,
  ).textContent();
  assert({
    given: 'a finished Round whose first struck line was erased',
    should:
      'list both strikes in order, the erased one as removed, and keep the commitment id out of the UI',
    actual: [
      text.includes('How the resolution was chosen'),
      text.includes(
        'Negative ran out of time; Daisy struck “A removed resolution”',
      ),
      text.includes('Affirmative struck “Kept line”'),
      text.includes('e'.repeat(64)),
    ],
    expected: [true, true, true, false],
  });
});

test('a spectator of a host-list draw reads struck lines as the host’s, not as removed (PR #472 review)', () => {
  const ended = endedDrawRound();
  const text = renderAccessible(
    <RoundReceipt
      round={{
        ...ended,
        resolutionAudit: {
          ...ended.resolutionAudit,
          items: ended.resolutionAudit.items.map((item) =>
            item.position === 2 ? item : { ...item, text: null },
          ),
          textsWithheld: true,
        },
      }}
    />,
  ).textContent();
  assert({
    given: 'an ended host-list draw read outside the Round',
    should: 'say the struck lines came from the host’s list',
    actual: [
      text.includes('Affirmative struck “A line from the host’s list”'),
      text.includes('A removed resolution'),
    ],
    expected: [true, false],
  });
});

test('a Round abandoned at the attendance cutoff blames nobody', () => {
  const text = renderAccessible(
    <RoundReceipt round={{ ...judged, status: 'abandoned', outcome: null }} />,
  ).textContent();
  assert({
    given: 'an abandoned judged Round, whose judge may well have ruled',
    should: 'say it closed, with no result line blaming the judges',
    actual: [
      text.includes('Round · Closed'),
      text.includes('Result ·'),
      text.includes('Judges did not rule'),
    ],
    expected: [true, false, false],
  });
});

test('a Round the platform ended states the cause', () => {
  const text = renderAccessible(
    <RoundReceipt
      round={{
        ...judged,
        status: 'abandoned',
        outcome: null,
        panelRuling: null,
        platformEnding: 'recovery_bound',
      }}
    />,
  ).textContent();
  assert({
    given: 'a Round ended by a platform incident',
    should: 'say the server failed, and that nothing counts or is charged',
    actual: [
      text.includes('Daisy server failure'),
      text.includes('No result, no rating and no charge'),
      text.includes('Judges did not rule'),
    ],
    expected: [true, true, false],
  });
});
