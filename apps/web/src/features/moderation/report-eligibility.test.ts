import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { ReportCreate } from '@daisy/protocol';
import { reportRefusal } from './report-eligibility';

setupRitewayBun();

const id = 'a'.repeat(24);
const round = (reason: 'harassment' | 'result_dispute' | 'integrity_concern') =>
  ({
    targetKind: 'round',
    targetId: id,
    reason,
  }) as const satisfies ReportCreate;
const feedback: ReportCreate = {
  targetKind: 'ballot_feedback',
  targetId: id,
  reason: 'abusive_feedback',
};
const chat: ReportCreate = {
  targetKind: 'chat_message',
  targetId: id,
  reason: 'spam',
};
const footage = (ranked: boolean, reporterSeated: boolean) =>
  ({ kind: 'footage', ranked, reporterSeated }) as const;

describe('Who may report what', () => {
  test('a target the reporter cannot read does not exist', () => {
    assert({
      given: 'a missing target',
      should: 'refuse as not found, whatever the reason',
      actual: reportRefusal(round('harassment'), { kind: 'missing' }),
      expected: 'report-not-found',
    });
  });

  test('any account may report conduct on a Round', () => {
    assert({
      given: 'an unseated account on a casual Round',
      should: 'accept',
      actual: reportRefusal(round('harassment'), footage(false, false)),
      expected: null,
    });
  });

  test('only a seat of a ranked Round disputes its result', () => {
    assert({
      given: 'a ranked seat, an unseated account, and a casual seat',
      should: 'accept only the ranked seat',
      actual: [
        reportRefusal(round('result_dispute'), footage(true, true)),
        reportRefusal(round('result_dispute'), footage(true, false)),
        reportRefusal(round('result_dispute'), footage(false, true)),
      ],
      expected: [null, 'report-not-eligible', 'report-not-eligible'],
    });
  });

  test('integrity concerns are about ranked Rounds, from anyone', () => {
    assert({
      given: 'an unseated account on a ranked and a casual Round',
      should: 'accept only ranked',
      actual: [
        reportRefusal(round('integrity_concern'), footage(true, false)),
        reportRefusal(round('integrity_concern'), footage(false, false)),
      ],
      expected: [null, 'report-not-eligible'],
    });
  });

  test('only the debater who received feedback can report it', () => {
    assert({
      given: 'the receiving debater, and anyone else',
      should:
        'accept the first, and answer not found so nobody learns it exists',
      actual: [
        reportRefusal(feedback, {
          kind: 'ballot_feedback',
          feedbackIsForReporter: true,
        }),
        reportRefusal(feedback, {
          kind: 'ballot_feedback',
          feedbackIsForReporter: false,
        }),
      ],
      expected: [null, 'report-not-found'],
    });
  });

  test('nobody reports their own chat message', () => {
    assert({
      given: 'their own message and someone else’s',
      should: 'refuse only their own',
      actual: [
        reportRefusal(chat, { kind: 'chat_message', ownMessage: true }),
        reportRefusal(chat, { kind: 'chat_message', ownMessage: false }),
      ],
      expected: ['report-not-eligible', null],
    });
  });
});
