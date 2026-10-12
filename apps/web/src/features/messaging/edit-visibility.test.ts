import { assert, setupRitewayBun, test } from 'riteway/bun';
import { editVisibility } from './edit-visibility';
setupRitewayBun();
const messageId = 'm'.repeat(24);
const live = {
  messages: [{ id: messageId, text: 'mine' }],
};
test('only revocation or removal ends an in-progress edit', () => {
  assert({
    given:
      'pending, live, transiently unavailable after content, denied, and removed or absent messages',
    should:
      'keep the form (and its draft) through transport or renewal gaps, ending it only on denial or removal',
    actual: [
      editVisibility({ status: 'pending', content: null }, messageId),
      editVisibility({ status: 'ready', content: live }, messageId),
      editVisibility({ status: 'unavailable', content: null }, messageId),
      editVisibility({ status: 'denied', content: null }, messageId),
      editVisibility(
        {
          status: 'ready',
          content: { messages: [{ id: messageId, unavailable: true }] },
        },
        messageId,
      ),
      editVisibility({ status: 'ready', content: { messages: [] } }, messageId),
    ],
    expected: ['form', 'form', 'form', 'revoked', 'removed', 'removed'],
  });
});
