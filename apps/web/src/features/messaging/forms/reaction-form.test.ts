import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { parseReactionForm } from './reaction-form';
setupRitewayBun();
test('native reaction form binds route scope and one explicit add/remove intent', async () => {
  const channel = 'c'.repeat(24),
    message = 'm'.repeat(24),
    request = 'r'.repeat(24);
  const form = new FormData();
  form.set('requestId', request);
  form.set('reaction', '👍');
  form.set('active', 'false');
  assert({
    given: 'a retained own reaction removal',
    should:
      'preserve the explicit false intent and only bound channel/message identifiers',
    actual: parseReactionForm(channel, message, form),
    expected: {
      version: 1,
      channelId: channel,
      messageId: message,
      requestId: request,
      reaction: '👍',
      active: false,
    },
  });
  for (const field of ['reaction', 'active']) {
    const duplicate = new FormData();
    for (const [key, value] of form) duplicate.append(key, value);
    duplicate.append(field, 'true');
    await assertRejects({
      given: 'duplicated native intent fields',
      should: 'refuse ambiguity before the operation',
      actual: async () => parseReactionForm(channel, message, duplicate),
      code: 'VALIDATION',
    });
  }
  form.set('active', 'yes');
  await assertRejects({
    given: 'a coercible nonboolean intent',
    should: 'reject rather than turn removal into addition',
    actual: async () => parseReactionForm(channel, message, form),
    code: 'VALIDATION',
  });
});
