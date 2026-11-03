import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { attendanceLedgerFacts } from './attendance-settlement';

setupRitewayBun();

const ledger = (adjudications: readonly unknown[]) => ({
  ruleSegments: [],
  speeches: [],
  adjudications,
  receipts: [],
  pendingWriter: false,
});
const row = {
  segmentId: 'a',
  decision: 'attended',
  evidence: 'on_time_receipt',
  effectiveDeadline: null,
  settledHorizon: null,
  receiptParticipantId: 'speaker',
};

test('a ledger row becomes the shape its evidence allows', async () => {
  assert({
    given: 'an on-time row as SQL selects it, nulls included',
    should: 'keep only what its evidence holds',
    actual: attendanceLedgerFacts(ledger([row])).adjudications,
    expected: [
      {
        segmentId: 'a',
        decision: 'attended',
        evidence: 'on_time_receipt',
        receiptParticipantId: 'speaker',
      },
    ],
  });
  for (const [given, corrupt] of [
    [
      'a settled row with no deadline',
      { ...row, evidence: 'settled_availability' },
    ],
    ['an on-time row that forfeits', { ...row, decision: 'forfeit' }],
    ['an unknown evidence word', { ...row, evidence: 'guess' }],
  ] as const)
    await assertRejects({
      given,
      should: 'refuse it as corruption',
      actual: async () => attendanceLedgerFacts(ledger([corrupt])),
      code: 'INVARIANT',
    });
});
