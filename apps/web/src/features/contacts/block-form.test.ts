import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  blockChanged,
  blockFields,
  blockFormUnavailable,
  initialBlockForm,
  parseBlockForm,
} from './block-form';
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
        username: 'peer_one',
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

test('a block form answer is one kind, and its fields follow from it', () => {
  const posted = new FormData();
  posted.set('requestId', 'r1');
  posted.set('username', 'peer_one');
  const answers = [
    initialBlockForm('r0'),
    blockFormUnavailable(posted),
    blockChanged({ requestId: 'r2', username: 'peer_one' }, true),
    blockChanged({ requestId: 'r3', username: 'peer_one' }, false),
  ];
  assert({
    given: 'nothing posted, a change that failed, a block and an unblock',
    should:
      'be idle with the page request id, refused keeping the same request id and username, and changed with a new request id and its confirmation',
    actual: answers.map((answer) => [answer.kind, blockFields(answer)]),
    expected: [
      ['idle', { requestId: 'r0', username: '', notice: undefined }],
      [
        'refused',
        {
          requestId: 'r1',
          username: 'peer_one',
          notice:
            'Could not change this contact. Your username is kept; try again.',
        },
      ],
      [
        'changed',
        { requestId: 'r2', username: 'peer_one', notice: 'Contact blocked.' },
      ],
      [
        'changed',
        { requestId: 'r3', username: 'peer_one', notice: 'Contact unblocked.' },
      ],
    ],
  });
});
