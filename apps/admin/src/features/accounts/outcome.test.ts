import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { auditedOutcome, commandView, mailDetail } from './outcome';

setupRitewayBun();

const result = {
  commandId: 'c'.repeat(24),
  outcome: 'changed',
  accessState: 'approved',
  accessRevision: 2,
  mail: 'queued',
} as const;

describe('command outcomes', () => {
  test('what the audit records', () => {
    assert({
      given: 'a result, a refusal and an unknown call',
      should: 'record changed or unchanged, rejected:<code>, or unknown',
      actual: [
        auditedOutcome({ kind: 'ok', value: result }),
        auditedOutcome({
          kind: 'ok',
          value: { ...result, outcome: 'unchanged' },
        }),
        auditedOutcome({ kind: 'rejected', code: 'CONFLICT' }),
        auditedOutcome({ kind: 'unknown' }),
      ],
      expected: [
        { outcome: 'changed', detail: 'mail_queued', settled: true },
        { outcome: 'unchanged', detail: 'mail_queued', settled: true },
        { outcome: 'rejected:CONFLICT', detail: null, settled: true },
        { outcome: 'unknown', detail: null, settled: false },
      ],
    });
  });

  test('the mail status a reconciliation reads back', () => {
    assert({
      given: 'each mail intent state and none',
      should: 'name it in the closed detail vocabulary',
      actual: (
        ['queued', 'leased', 'sent', 'failed', 'cancelled', null] as const
      ).map(mailDetail),
      expected: [
        'mail_queued',
        'mail_queued',
        'mail_sent',
        'mail_failed',
        'mail_cancelled',
        'mail_none',
      ],
    });
  });

  test('what the operator is shown', () => {
    assert({
      given: 'a result, a conflict, another refusal and an unknown call',
      should: 'name the notice the accounts page renders',
      actual: [
        commandView({ kind: 'ok', value: result }),
        commandView({ kind: 'rejected', code: 'CONFLICT' }),
        commandView({ kind: 'rejected', code: 'NOT_FOUND' }),
        commandView({ kind: 'unknown' }),
      ],
      expected: [
        { notice: 'changed', mail: 'queued' },
        { notice: 'conflict', mail: null },
        { notice: 'refused', mail: null },
        { notice: 'unknown', mail: null },
      ],
    });
  });
});
