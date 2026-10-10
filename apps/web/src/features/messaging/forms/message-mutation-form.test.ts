import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  parseMessageMutationForm,
  messageMutationUnavailable,
} from './message-mutation-form';
setupRitewayBun();
test('own-message forms distinguish edit text from removal without trusting posted scope', async () => {
  const channel = 'c'.repeat(24),
    message = 'm'.repeat(24),
    requestId = 'r'.repeat(24);
  const form = new FormData();
  form.set('requestId', requestId);
  form.set('text', 'Kept revised contribution');
  form.set('operation', 'edit');
  const edited = parseMessageMutationForm(channel, message, form);
  form.set('operation', 'remove');
  const removed = parseMessageMutationForm(channel, message, form);
  assert({
    given: 'one native form with explicit edit and remove controls',
    should: 'bind route identifiers and include draft text only in edit intent',
    actual: [edited, removed],
    expected: [
      {
        operation: 'edit',
        command: {
          version: 1,
          channelId: channel,
          messageId: message,
          requestId,
          text: 'Kept revised contribution',
        },
      },
      {
        operation: 'remove',
        command: {
          version: 1,
          channelId: channel,
          messageId: message,
          requestId,
        },
      },
    ],
  });
  form.append('operation', 'edit');
  await assertRejects({
    given: 'ambiguous native operation controls',
    should: 'refuse rather than choose a destructive intent',
    actual: async () => parseMessageMutationForm(channel, message, form),
    code: 'VALIDATION',
  });
});

test('native mutation refusal retains draft and request identity without permitting malformed message scope', async () => {
  const form = new FormData();
  form.set('text', 'Retained own edit');
  form.set('requestId', 'r'.repeat(24));
  form.set('operation', 'edit');
  assert({
    given: 'a refused native own-message draft',
    should: 'retain the exact draft/request with a content-free notice',
    actual: messageMutationUnavailable(form),
    expected: {
      text: 'Retained own edit',
      requestId: 'r'.repeat(24),
      notice: 'Your message could not be changed. The text is kept; try again.',
    },
  });
  await assertRejects({
    given: 'an invalid bound message identifier',
    should: 'reject before an operation can inspect author or content',
    actual: async () =>
      parseMessageMutationForm('c'.repeat(24), 'foreign', form),
    code: 'VALIDATION',
  });
});
