import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { ContentReportCreate } from '@daisy/protocol';
import { reportRefusal } from './report-eligibility';

setupRitewayBun();

const id = 'a'.repeat(24);
const round = (reason: 'harassment' | 'result_dispute' | 'integrity_concern') =>
  ({
    targetKind: 'round',
    targetId: id,
    reason,
  }) as const satisfies ContentReportCreate;
const feedback: ContentReportCreate = {
  targetKind: 'ballot_feedback',
  targetId: id,
  reason: 'abusive_feedback',
};
const chat: ContentReportCreate = {
  targetKind: 'chat_message',
  targetId: id,
  reason: 'spam',
};
const reachable = {
  roundId: id,
  visibility: 'public',
  audienceLinkHash: null,
  inLiveRoom: false,
} as const;
const footage = (ranked: boolean, reporterSeated: boolean) =>
  ({ kind: 'footage', ranked, reporterSeated, audience: reachable }) as const;
const noLink = () => null;

describe('Who may report what', () => {
  test('a target the reporter cannot read does not exist', () => {
    assert({
      given: 'a missing target',
      should: 'refuse as not found, whatever the reason',
      actual: reportRefusal(round('harassment'), { kind: 'missing' }, noLink),
      expected: 'report-not-found',
    });
  });

  test('a Round the reporter cannot reach does not exist', () => {
    const on = (audience: Partial<typeof reachable> | object) =>
      ({
        kind: 'footage',
        ranked: false,
        reporterSeated: false,
        audience: { ...reachable, ...audience },
      }) as never;
    const unlisted = { visibility: 'unlisted', audienceLinkHash: 'current' };
    assert({
      given:
        'an unlisted Round with no link, the old link, the link and a live room place, then a private Round',
      should:
        'answer not found except by the link or the live room, even for a reason that would not qualify',
      actual: [
        reportRefusal(round('harassment'), on(unlisted), noLink),
        reportRefusal(round('result_dispute'), on(unlisted), noLink),
        reportRefusal(round('harassment'), on(unlisted), () => 'old'),
        reportRefusal(round('harassment'), on(unlisted), () => 'current'),
        reportRefusal(
          round('harassment'),
          on({ ...unlisted, inLiveRoom: true }),
          noLink,
        ),
        reportRefusal(
          round('harassment'),
          on({ visibility: 'private' }),
          noLink,
        ),
      ],
      expected: [
        'report-not-found',
        'report-not-found',
        'report-not-found',
        null,
        null,
        'report-not-found',
      ],
    });
  });

  test('any account may report conduct on a Round', () => {
    assert({
      given: 'an unseated account on a casual Round',
      should: 'accept',
      actual: reportRefusal(round('harassment'), footage(false, false), noLink),
      expected: null,
    });
  });

  test('only a seat of a ranked Round disputes its result', () => {
    assert({
      given: 'a ranked seat, an unseated account, and a casual seat',
      should: 'accept only the ranked seat',
      actual: [
        reportRefusal(round('result_dispute'), footage(true, true), noLink),
        reportRefusal(round('result_dispute'), footage(true, false), noLink),
        reportRefusal(round('result_dispute'), footage(false, true), noLink),
      ],
      expected: [null, 'report-not-eligible', 'report-not-eligible'],
    });
  });

  test('integrity concerns are about ranked Rounds, from anyone', () => {
    assert({
      given: 'an unseated account on a ranked and a casual Round',
      should: 'accept only ranked',
      actual: [
        reportRefusal(round('integrity_concern'), footage(true, false), noLink),
        reportRefusal(
          round('integrity_concern'),
          footage(false, false),
          noLink,
        ),
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
        reportRefusal(
          feedback,
          { kind: 'ballot_feedback', feedbackIsForReporter: true },
          noLink,
        ),
        reportRefusal(
          feedback,
          { kind: 'ballot_feedback', feedbackIsForReporter: false },
          noLink,
        ),
      ],
      expected: [null, 'report-not-found'],
    });
  });

  test('nobody reports their own chat message', () => {
    assert({
      given: 'their own message and someone else’s',
      should: 'refuse only their own',
      actual: [
        reportRefusal(
          chat,
          { kind: 'chat_message', ownMessage: true, audience: reachable },
          noLink,
        ),
        reportRefusal(
          chat,
          { kind: 'chat_message', ownMessage: false, audience: reachable },
          noLink,
        ),
      ],
      expected: ['report-not-eligible', null],
    });
  });
});
