import {
  attendanceTimingPolicy as policy,
  type AttendanceLedgerFacts,
} from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  attendanceSettled,
  finalSpeechKey,
  nextAttendanceSegment,
} from './attendance-order';

setupRitewayBun();
const at = (ms: number) => new Date(ms).toISOString();
const ruleSegments = [
  { key: 'AC', type: 'speech' },
  { key: 'CX', type: 'cross_ex' },
  { key: 'NC', type: 'speech' },
];
const segment = (id: string, key: string, type = 'speech') => ({
  id,
  rulesSegmentKey: key,
  type,
});

test('windows resolve in actual speech order, never the final speech', () => {
  const segments = [
    segment('a', 'AC'),
    segment('x', 'CX', 'cross_ex'),
    segment('n', 'NC'),
  ];
  assert({
    given: 'the rules',
    should: 'name the last speech, whatever follows it',
    actual: finalSpeechKey([...ruleSegments, { key: 'X', type: 'cross_ex' }]),
    expected: 'NC',
  });
  assert({
    given: 'no decision yet, then the first speech decided',
    should:
      'take the first speech, then no window, since only the final speech is left',
    actual: [
      nextAttendanceSegment({ ruleSegments, segments, finalizedSegmentIds: [] })
        ?.id,
      nextAttendanceSegment({
        ruleSegments,
        segments,
        finalizedSegmentIds: ['a'],
      }),
    ],
    expected: ['a', undefined],
  });
});

const opened = 100_000;
const speeches = [
  { id: 'a', rulesSegmentKey: 'AC', startedAt: at(opened) },
  { id: 'n', rulesSegmentKey: 'NC', startedAt: at(opened + 300_000) },
];
const deadline = opened + policy.graceMs;
const settled = {
  segmentId: 'a',
  decision: 'attended',
  evidence: 'settled_availability',
  effectiveDeadline: at(deadline),
  settledHorizon: at(deadline + policy.finalizationBufferMs),
} as const;
const onTime = {
  segmentId: 'a',
  decision: 'attended',
  evidence: 'on_time_receipt',
  receiptParticipantId: 'speaker',
} as const;
const facts = (
  overrides: Partial<AttendanceLedgerFacts> = {},
): AttendanceLedgerFacts => ({
  ruleSegments,
  speeches,
  adjudications: [settled],
  receipts: [],
  pendingWriter: false,
  ...overrides,
});
const nowMs = deadline + policy.finalizationBufferMs;

test('one settlement rule (ISSUE-998)', () => {
  const receipt = (receivedAtMs: number) => ({
    segmentId: 'a',
    participantId: 'speaker',
    receivedAt: at(receivedAtMs),
  });
  const cases = [
    ['a settled decision past its buffer', facts(), nowMs, true],
    ['the same before its buffer has passed', facts(), nowMs - 1, false],
    ['an uncertain writer', facts({ pendingWriter: true }), nowMs, false],
    [
      'no decision on a non-final speech',
      facts({ adjudications: [] }),
      nowMs,
      false,
    ],
    [
      'a horizon short of the buffer',
      facts({ adjudications: [{ ...settled, settledHorizon: at(deadline) }] }),
      nowMs,
      false,
    ],
    [
      'a deadline earlier than the base window',
      facts({
        adjudications: [
          {
            ...settled,
            effectiveDeadline: at(deadline - 1),
            settledHorizon: at(nowMs),
          },
        ],
      }),
      nowMs,
      false,
    ],
    [
      'a forfeit',
      facts({ adjudications: [{ ...settled, decision: 'forfeit' }] }),
      nowMs,
      false,
    ],
    [
      'an abandonment at the cutoff',
      facts({
        adjudications: [
          {
            segmentId: 'a',
            decision: 'abandoned',
            evidence: 'resolution_cutoff',
          },
        ],
      }),
      nowMs,
      false,
    ],
    [
      'an on-time receipt that exists',
      facts({ adjudications: [onTime], receipts: [receipt(opened)] }),
      0,
      true,
    ],
    [
      'an on-time decision with no receipt',
      facts({ adjudications: [onTime] }),
      nowMs,
      false,
    ],
    [
      'a receipt after the grace',
      facts({ adjudications: [onTime], receipts: [receipt(deadline + 1)] }),
      nowMs,
      false,
    ],
    [
      'a receipt before the lead',
      facts({
        adjudications: [onTime],
        receipts: [receipt(opened - policy.leadMs - 1)],
      }),
      nowMs,
      false,
    ],
    [
      'no speech played but the final one',
      facts({ speeches: [speeches[1]!], adjudications: [] }),
      nowMs,
      true,
    ],
  ] as const;
  for (const [given, ledger, now, expected] of cases)
    assert({
      given,
      should: expected ? 'settle' : 'not settle',
      actual: attendanceSettled(ledger, now),
      expected,
    });
});
