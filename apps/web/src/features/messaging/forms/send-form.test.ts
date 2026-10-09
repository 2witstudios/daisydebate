import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { parseMessageForm } from './send-form';
setupRitewayBun();
const channelId = 'c'.repeat(24);
const requestId = 'r'.repeat(24);
test('native message forms bind the channel and preserve exact message text', async () => {
  const form = new FormData();
  form.set('requestId', requestId);
  form.set('text', '  hello\nthere  ');
  assert({
    given: 'a native form with an application-issued request identity',
    should: 'use the bound channel and preserve text bytes for idempotency',
    actual: parseMessageForm(channelId, form),
    expected: { version: 1, channelId, requestId, text: '  hello\nthere  ' },
  });
  form.append('text', 'another body');
  await assertRejects({
    given: 'duplicate text fields',
    should: 'refuse ambiguous message submission',
    actual: async () => parseMessageForm(channelId, form),
    code: 'VALIDATION',
  });
});
