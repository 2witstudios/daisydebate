import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  contentModerationActions,
  contentModerationCommands,
  queueOfReason,
  reasonsForTarget,
  contentReportCreateSchema,
  contentReportTargetKinds,
} from './content-moderation';

setupRitewayBun();

const id = 'a'.repeat(24);
const accepts = (value: unknown) =>
  contentReportCreateSchema.safeParse(value).success;

describe('A report', () => {
  test('each target takes only its own reasons', () => {
    assert({
      given: 'a reason on the right and on the wrong target',
      should: 'accept the first of each pair and refuse the second',
      actual: [
        accepts({
          targetKind: 'round',
          targetId: id,
          reason: 'result_dispute',
        }),
        accepts({
          targetKind: 'chat_message',
          targetId: id,
          reason: 'result_dispute',
        }),
        accepts({
          targetKind: 'ballot_feedback',
          targetId: id,
          reason: 'abusive_feedback',
        }),
        accepts({
          targetKind: 'ballot_feedback',
          targetId: id,
          reason: 'spam',
        }),
      ],
      expected: [true, false, true, false],
    });
  });

  test('a report carries no free text', () => {
    assert({
      given: 'a report with a note',
      should: 'refuse it',
      actual: accepts({
        targetKind: 'round',
        targetId: id,
        reason: 'other',
        note: 'free text',
      }),
      expected: false,
    });
  });

  test('every reason a form offers parses for its target', () => {
    const offered = contentReportTargetKinds.flatMap((targetKind) =>
      reasonsForTarget(targetKind).map((reason) =>
        accepts({ targetKind, targetId: id, reason }),
      ),
    );
    assert({
      given: 'each target and each reason offered for it',
      should: 'accept all of them',
      actual: offered.every(Boolean),
      expected: true,
    });
  });

  test('dispute and integrity reasons go to review', () => {
    assert({
      given: 'a dispute, an integrity concern, and harassment',
      should: 'send the first two to review and the last to safety',
      actual: [
        queueOfReason('result_dispute'),
        queueOfReason('integrity_concern'),
        queueOfReason('harassment'),
      ],
      expected: ['review', 'review', 'safety'],
    });
  });
});

describe('Operator moderation commands', () => {
  test('each action is its own closed command', () => {
    const fields = {
      v: 1,
      commandId: id,
      adminAuditHead: 'f'.repeat(64),
    };
    assert({
      given: 'a stop with a reason, one with a stray field, and one with none',
      should: 'accept only the first',
      actual: [
        contentModerationCommands['broadcast.stop'].safeParse({
          ...fields,
          reason: 'technical',
        }).success,
        contentModerationCommands['broadcast.stop'].safeParse({
          ...fields,
          reason: 'technical',
          state: 'banned',
        }).success,
        contentModerationCommands['broadcast.stop'].safeParse(fields).success,
      ],
      expected: [true, false, false],
    });
  });

  test('the actions are named and closed', () => {
    assert({
      given: 'the moderation contract',
      should: 'name each action exactly',
      actual: [...contentModerationActions].sort(),
      expected: [
        'account.audience_ban.update',
        'broadcast.chat_slow_mode.update',
        'broadcast.stop',
        'chat_message.remove',
        'content_report.resolve',
        'recording.remove',
        'recording.restore',
        'recording.takedown',
      ],
    });
  });
});
