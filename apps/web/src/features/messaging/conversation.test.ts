import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { readConversationResponse } from './conversation';
setupRitewayBun();
test('conversation wire responses require authorized configured bounds and coherent portable history', async () => {
  assert({
    given: 'a refused history read',
    should: 'provide no content to the conversation',
    actual: await readConversationResponse(new Response(null, { status: 403 })),
    expected: null,
  });
  await assertRejects({
    given: 'an OK response missing its configured bounds',
    should: 'refuse rather than invent product limits',
    actual: () => readConversationResponse(Response.json({})),
    code: 'INFRASTRUCTURE',
  });
  await assertRejects({
    given: 'configured bounds with malformed history',
    should: 'refuse the serialized content at the render boundary',
    actual: () =>
      readConversationResponse(
        Response.json(
          {},
          {
            headers: {
              'x-messaging-message-units': '100',
              'x-messaging-page-items': '10',
            },
          },
        ),
      ),
    code: 'INFRASTRUCTURE',
  });
});
