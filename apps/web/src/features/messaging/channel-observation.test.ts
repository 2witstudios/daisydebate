import { assert, setupRitewayBun, test } from 'riteway/bun';
import { channelMessages } from './channel-observation';
setupRitewayBun();
const channelId = 'c'.repeat(24);
const message = (sequence: number, channel = channelId) => ({
  id: String.fromCharCode(96 + sequence).repeat(24),
  channelId: channel,
  authorActorId: 'a'.repeat(24),
  sequence,
  changeVersion: sequence,
  text: `m${sequence}`,
  createdAt: '2026-10-12T00:00:00.000Z',
  editedAt: null,
});
test('channel descriptor decodes only bounded bodies of its own channel', () => {
  const descriptor = channelMessages(
    channelId,
    { messageUnits: 10, pageItems: 20 },
    7,
  );
  assert({
    given:
      'a history position, a valid body, a foreign body and an oversized text',
    should: 'bind the window once and refuse anything not this conversation',
    actual: {
      window: descriptor.window,
      valid: descriptor.decode({ messages: [message(5)], continuation: 5 }),
      foreign: descriptor.decode({
        messages: [message(5, 'd'.repeat(24))],
        continuation: null,
      }),
      oversized: descriptor.decode({
        messages: [{ ...message(5), text: 'x'.repeat(11) }],
        continuation: null,
      }),
    },
    expected: {
      window: { after: 7, limit: 20 },
      valid: { messages: [message(5)], continuation: 5 },
      foreign: null,
      oversized: null,
    },
  });
});
