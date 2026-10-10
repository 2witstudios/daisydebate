import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { parseBlockForm } from './block-form';
setupRitewayBun();
test('native safety forms bind exact username, operation and request identity', async () => {
  const form = new FormData();
  form.set('requestId', 'r'.repeat(24));
  form.set('username', 'peer_one');
  for (const decision of ['block', 'unblock']) {
    form.set('decision', decision);
    assert({
      given: `a ${decision} submission`,
      should: 'preserve intent without granting contact or content authority',
      actual: parseBlockForm(form),
      expected: {
        version: 1,
        requestId: 'r'.repeat(24),
        recipientUsername: 'peer_one',
        blocked: decision === 'block',
      },
    });
  }
  form.set('decision', 'read');
  await assertRejects({
    given: 'an unsupported safety operation',
    should: 'refuse',
    actual: async () => parseBlockForm(form),
    code: 'VALIDATION',
  });
  form.set('decision', 'block');
  form.append('username', 'different');
  await assertRejects({
    given: 'ambiguous subject fields',
    should: 'refuse before discovery',
    actual: async () => parseBlockForm(form),
    code: 'VALIDATION',
  });
});
