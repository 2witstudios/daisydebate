import { assert, setupRitewayBun, test } from 'riteway/bun';
import { liveReactions } from './reaction-view';
setupRitewayBun();
const messageId = 'm'.repeat(24);
const initial = [{ reaction: 'up', count: 1, own: true }];
const view = (overrides: object) => ({
  status: 'ready',
  withdrawn: false,
  overlay: {
    ownReactions: [
      { messageId, reaction: 'heart' },
      { messageId: 'o'.repeat(24), reaction: 'up' },
    ],
  },
  content: {
    messages: [
      {
        id: messageId,
        reactions: [
          { reaction: 'heart', count: 2 },
          { reaction: 'up', count: 3 },
        ],
      },
    ],
  },
  ...overrides,
});
test('reaction state comes from shared counts plus this viewer’s own overlay', () => {
  assert({
    given:
      'a live window, no live content yet, a denied or withdrawn view and a removed message',
    should:
      'flag only this message’s own reactions, fall back to the authorized read, and hide on revocation or removal',
    actual: [
      liveReactions(view({}), messageId, initial),
      liveReactions(view({ content: null }), messageId, initial),
      liveReactions(
        view({ status: 'denied', content: null }),
        messageId,
        initial,
      ),
      liveReactions(
        view({ withdrawn: true, content: null }),
        messageId,
        initial,
      ),
      liveReactions(
        view({ content: { messages: [{ id: messageId, unavailable: true }] } }),
        messageId,
        initial,
      ),
    ],
    expected: [
      {
        kind: 'list',
        items: [
          { reaction: 'heart', count: 2, own: true },
          { reaction: 'up', count: 3, own: false },
        ],
      },
      { kind: 'list', items: initial },
      { kind: 'revoked' },
      { kind: 'revoked' },
      { kind: 'removed' },
    ],
  });
});
