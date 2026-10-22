import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  oneOnOneDefinition,
  practiceRoomConfig,
} from '@daisy/db/reference-formats';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { attendanceWindowFor } from './windows';
setupRitewayBun();
const compiled = resolveRoomConfiguration(
  oneOnOneDefinition,
  practiceRoomConfig,
);
if (!compiled.ok) throw new Error('Canonical rules fixture refused');
const rules = {
  ...compiled.rules,
  seats: { affirmative: 2, negative: 2, judge: 1 },
  segments: compiled.rules.segments.map((s) =>
    s.key === 'AC' ? { ...s, slot: 1 } : s,
  ),
};
const participants = [
  { id: 'a0', actorId: 'actor-a0', role: 'affirmative' as const, slot: 0 },
  { id: 'a1', actorId: 'actor-a1', role: 'affirmative' as const, slot: 1 },
  { id: 'n0', actorId: 'actor-n0', role: 'negative' as const, slot: 0 },
  { id: 'n1', actorId: 'actor-n1', role: 'negative' as const, slot: 1 },
  { id: 'judge', actorId: 'actor-j', role: 'judge' as const, slot: 0 },
];
const actual = {
  id: 'actual-ac',
  sequence: 0,
  type: 'speech' as const,
  rulesSegmentKey: 'AC',
  startedAt: '2026-10-22T00:02:15.000Z',
  endedAt: '2026-10-22T00:02:30.000Z',
  durationMs: rules.segments[0]!.durationMs,
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
      openedAtMs: Date.parse(actual.startedAt),
      speakerId: 'a1',
      speakerSide: 'affirmative',
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
