import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sanctionFormBody, sanctionFormAnswer } from './sanction-form';
setupRitewayBun();
test('sanction form preserves actual versions and refuses changed requests', () => {
  const context = {
    organizationId: createId(),
    lobbyId: createId(),
    sanctionId: createId(),
    commandId: createId(),
    version: 7,
    decision: 'approve-sanction' as const,
    handle: 'actual',
  };
  const body = sanctionFormBody(context);
  assert({
    given: 'a displayed sanction and its actual version',
    should: 'retry the identical command without refreshing its version',
    actual: [
      body.envelope.commandId,
      body.envelope.expected,
      body.envelope.command,
    ],
    expected: [
      context.commandId,
      { sanction: 7 },
      { type: 'approve-sanction', sanctionId: context.sanctionId },
    ],
  });
  assert({
    given: 'a request changed by another host',
    should: 'tell the host to reload without claiming approval',
    actual: sanctionFormAnswer(new FormData(), {
      kind: 'refused',
      refusal: 'version-conflict',
    }).kind,
    expected: 'refused',
  });
  assert({
    given: 'an unreadable response after posting a decision',
    should: 'keep it uncertain so the same command can be retried',
    actual: sanctionFormAnswer(new FormData(), {}).kind,
    expected: 'unacknowledged',
  });
});
