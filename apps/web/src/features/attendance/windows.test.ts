import { instantMs, addMs } from '@daisy/clock';
import { emptyRuntimeCheckpointFor } from '@daisy/protocol/round';
import { twoSides } from '@daisy/protocol/seats';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  oneOnOneDefinition,
  oneOnOneSettings,
} from '@daisy/db/reference-formats';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import type { LockedAttendanceCheckIn } from '@daisy/db/attendance';
import { isAppError } from '@daisy/errors';
import { attendanceTimingPolicy } from '@daisy/protocol/attendance';
import { acceptAttendanceReceipt } from './receipt-window';
import { attendanceWindowFor } from './windows';
setupRitewayBun();
const compiled = resolveRoomConfiguration(oneOnOneDefinition, oneOnOneSettings);
if (!compiled.ok) throw new Error('Canonical rules fixture refused');
const rules = {
  ...compiled.rules,
  seats: {
    ...compiled.rules.seats,
    sides: { affirmative: 2, negative: 2 },
    judges: 1,
  },
  segments: compiled.rules.segments.map((s) =>
    s.key === 'AC'
      ? {
          ...s,
          speak: {
            rights: 'one' as const,
            seat: { kind: 'side' as const, side: 'affirmative', slot: 1 },
          },
        }
      : s,
  ),
};
const participants = [
  {
    id: 'a0',
    actorId: 'actor-a0',
    seat: { kind: 'side', side: 'affirmative', slot: 0 } as const,
  },
  {
    id: 'a1',
    actorId: 'actor-a1',
    seat: { kind: 'side', side: 'affirmative', slot: 1 } as const,
  },
  {
    id: 'n0',
    actorId: 'actor-n0',
    seat: { kind: 'side', side: 'negative', slot: 0 } as const,
  },
  {
    id: 'n1',
    actorId: 'actor-n1',
    seat: { kind: 'side', side: 'negative', slot: 1 } as const,
  },
  {
    id: 'judge',
    actorId: 'actor-j',
    seat: { kind: 'judge', slot: 0 } as const,
  },
];
const actual = {
  id: 'actual-ac',
  sequence: 0,
  type: 'speech' as const,
  rulesSegmentKey: 'AC',
  startedAt: '2026-10-22T00:02:15.000Z',
  endedAt: '2026-10-22T00:02:30.000Z',
  durationMs: rules.segments[0]!.durationMs,
  returnedMs: 0,
};
test('attendance uses actual opening and scheduled speaker slot after later runtime movement', () => {
  const result = attendanceWindowFor(
    { rules, participants, segments: [actual] },
    actual.id,
    participants.map((p) => p.id),
  );
  assert({
    given: 'actual speech opened after prep and scheduled speaker is slot one',
    should:
      'preserve actual opening and exact slot while including every opposing seat and excluding judges',
    actual: result,
    expected: {
      segmentId: actual.id,
      openedAtMs: instantMs(actual.startedAt),
      speakerId: 'a1',
      speakerSide: 'affirmative',
      forfeitsTo: 'negative',
      eligibleSeats: [
        { id: 'a0', side: 'affirmative' },
        { id: 'a1', side: 'affirmative' },
        { id: 'n0', side: 'negative' },
        { id: 'n1', side: 'negative' },
      ],
      lastSpeech: false,
    },
  });
});
test('last speech classification comes from frozen rules not latest currently persisted row', () => {
  const last = rules.segments.filter((s) => s.type === 'speech').at(-1)!;
  const result = attendanceWindowFor(
    {
      rules,
      participants,
      segments: [
        {
          ...actual,
          id: 'actual-last',
          rulesSegmentKey: last.key,
          durationMs: last.durationMs,
          returnedMs: 0,
        },
      ],
    },
    'actual-last',
    ['a0', 'n0'],
  );
  assert({
    given: 'actual final speech row',
    should: 'exclude this speech from competitive attendance adjudication',
    actual: result.lastSpeech,
    expected: true,
  });
});

/** Healthy one-second samples settling the whole grace period and beyond. */
const healthy = Array.from({ length: 50 }, (_, i) => ({
  at: addMs(actual.startedAt, (i - 2) * 1000),
  healthy: true,
}));
const receipt = (
  offsetMs: number,
  change: {
    finalized?: boolean;
    status?: string;
    segmentId?: string;
    unsettled?: boolean;
  } = {},
) => {
  const facts = {
    round: {
      checkpoint: emptyRuntimeCheckpointFor({ sides: twoSides }),
      rules,
      participants,
      segments: [actual],
      status: change.status ?? 'active',
    },
    eligibleParticipantIds: participants.map((p) => p.id),
    samples: change.unsettled ? [] : healthy,
    finalizedSegmentIds: change.finalized ? [actual.id] : [],
    participantId: 'a0',
    receivedAt: addMs(actual.startedAt, offsetMs),
  } as unknown as LockedAttendanceCheckIn;
  try {
    acceptAttendanceReceipt(facts, change.segmentId ?? actual.id);
    return 'accepted';
  } catch (error) {
    return isAppError(error) ? `${error.code}:${error.reason}` : 'unknown';
  }
};

test('a check-in receipt is accepted only inside the actual speech window', () => {
  const { leadMs, graceMs } = attendanceTimingPolicy;
  assert({
    given:
      'receipts at the lead edge, the opening, the grace edge, too early, too late, and late without settled availability',
    should:
      'accept the window, name which side a refusal fell on, and keep an unsettled deadline open',
    actual: [
      ...[-leadMs, 0, graceMs, -leadMs - 1, graceMs + 1].map((ms) =>
        receipt(ms),
      ),
      receipt(graceMs + 1, { unsettled: true }),
    ],
    expected: [
      'accepted',
      'accepted',
      'accepted',
      'CONFLICT:attendance-too-early',
      'CONFLICT:attendance-window-closed',
      'accepted',
    ],
  });
});

test('a finalized speech, a finished Round or a non-speech refuses the receipt', () => {
  assert({
    given: 'a finalized speech, a completed Round and an unknown segment',
    should: 'close the window, or refuse the segment itself',
    actual: [
      receipt(0, { finalized: true }),
      receipt(0, { status: 'completed' }),
      receipt(0, { segmentId: 'cross-ex' }),
    ],
    expected: [
      'CONFLICT:attendance-window-closed',
      'CONFLICT:attendance-window-closed',
      'CONFLICT:attendance-segment',
    ],
  });
});
