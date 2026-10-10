import { assert, setupRitewayBun, test } from 'riteway/bun';
import { clientMessageSchema, serverMessageSchema } from '@daisy/protocol';
import { fixture, topic } from './registry.test-support';

setupRitewayBun();

test('a native unsubscribe request emits only canonical server framing', async () => {
  const { registry, connection, sent, attached } = fixture();
  await registry.subscribe(connection, { id: 'subscribe', topic });
  const request = clientMessageSchema.parse({
    v: 1,
    type: 'unsubscribe',
    id: 'release',
    topic,
  });
  if (request.type !== 'unsubscribe')
    throw new Error('Unsubscribe fixture refused');
  registry.unsubscribe(connection, request);
  const reply = sent.at(-1);
  assert({
    given: 'the complete validated client envelope on final consumer release',
    should:
      'detach and emit a valid unsubscribed reply without client envelope overwrite',
    actual: {
      reply,
      valid: serverMessageSchema.safeParse(reply).success,
      attached: attached.size,
    },
    expected: {
      reply: { v: 1, type: 'unsubscribed', id: 'release', topic },
      valid: true,
      attached: 0,
    },
  });
});
