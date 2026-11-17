import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  judgeObligationEnvelope,
  judgeObligationAnswer,
} from './judge-obligation-form';
setupRitewayBun();
const context = {
  eventId: 'qndsohpp7nihje7a2dw3a2kl',
  commandId: 'lguvh1y1ejhadk96xcftohha',
  settingsVersion: 7,
  handle: 'spring',
};
test('judge obligation form retains displayed version and command identity', () => {
  const form = new FormData();
  form.set('entries-per-judge', '3');
  form.set('judges-per-group', '0');
  const envelope = judgeObligationEnvelope(context, form);
  assert({
    given: 'an explicit zero-judge policy',
    should: 'submit the canonical event setting with its displayed guard',
    actual: envelope,
    expected: {
      version: 1,
      commandId: context.commandId,
      expected: { settings: 7 },
      command: {
        type: 'set-setting',
        scope: { kind: 'event', id: context.eventId },
        key: 'entry.judge_obligation',
        value: { kind: 'ratio', entriesPerJudge: 3, judgesPerGroup: 0 },
        hold: 'default',
      },
    },
  });
  assert({
    given: 'a lost response',
    should: 'retain exactly the same form for an identical command retry',
    actual: judgeObligationAnswer(form, {}),
    expected: {
      kind: 'unacknowledged',
      values: { 'entries-per-judge': '3', 'judges-per-group': '0' },
    },
  });
  assert({
    given: 'duplicate policy fields',
    should: 'reject ambiguous submission',
    actual: (() => {
      form.append('entries-per-judge', '2');
      try {
        judgeObligationEnvelope(context, form);
        return false;
      } catch {
        return true;
      }
    })(),
    expected: true,
  });
});
