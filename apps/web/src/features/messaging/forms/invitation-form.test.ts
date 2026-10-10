import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { parseInvitationDecisionForm } from './invitation-form';
setupRitewayBun();
test('native invitation decision binds the server preview generation and one recipient choice', async () => {
  const channel = 'g'.repeat(24),
    requestId = 'r'.repeat(24);
  const form = new FormData();
  form.set('requestId', requestId);
  form.set('decision', 'decline');
  assert({
    given: 'a recipient refusal form',
    should: 'retain exact request ID, channel and observed generation',
    actual: parseInvitationDecisionForm(channel, 3, form),
    expected: {
      version: 1,
      channelId: channel,
      requestId,
      decision: 'decline',
      expectedGeneration: 3,
    },
  });
  for (const generation of [0, 4.5, '3'])
    await assertRejects({
      given: 'a malformed preview generation',
      should: 'refuse before HTTP mutation',
      actual: () => parseInvitationDecisionForm(channel, generation, form),
      code: 'VALIDATION',
    });
  form.set('decision', 'cancel');
  await assertRejects({
    given: 'an inviter action injected into the recipient form',
    should: 'refuse without changing invitation state',
    actual: () => parseInvitationDecisionForm(channel, 3, form),
    code: 'VALIDATION',
  });
  form.set('decision', 'accept');
  form.append('decision', 'decline');
  await assertRejects({
    given: 'ambiguous recipient choices',
    should: 'refuse before reading or writing the invitation',
    actual: () => parseInvitationDecisionForm(channel, 3, form),
    code: 'VALIDATION',
  });
});
