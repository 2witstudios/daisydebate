import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { readConversationResponse, readThroughSequence } from './conversation';
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

test('authorized conversation carries only the explicitly supplied typing recovery interval', async () => {
  const history = {
    version: 1,
    channelId: 'c'.repeat(24),
    changeVersion: 0,
    messages: [],
    nextBefore: null,
  };
  const response = (interval?: string) =>
    Response.json(history, {
      headers: {
        'x-messaging-message-units': '100',
        'x-messaging-page-items': '10',
        ...(interval === undefined
          ? {}
          : { 'x-messaging-typing-refetch-ms': interval }),
      },
    });
  const supplied = await readConversationResponse(response('700')),
    absent = await readConversationResponse(response());
  assert({
    given: 'authorized history with explicit timing versus absent timing',
    should:
      'pass exactly configured timing to the browser without inventing a default',
    actual: [supplied?.typingRefetchMs, absent?.typingRefetchMs],
    expected: [700, null],
  });
  for (const invalid of ['0', '-1', 'NaN', '0.5', '9007199254740992'])
    await assertRejects({
      given: 'malformed configured recovery metadata',
      should: 'refuse instead of scheduling an unsafe browser interval',
      actual: () => readConversationResponse(response(invalid)),
      code: 'INFRASTRUCTURE',
    });
});
test('only the live first page marks a conversation read', () => {
  const channelId = 'c'.repeat(24);
  const history = {
    version: 1 as const,
    channelId,
    changeVersion: 9,
    nextBefore: null,
    messages: [
      {
        id: 'b'.repeat(24),
        channelId,
        sequence: 7,
        changeVersion: 9,
        unavailable: true as const,
      },
      {
        id: 'a'.repeat(24),
        channelId,
        authorActorId: 'x'.repeat(24),
        sequence: 6,
        changeVersion: 6,
        text: 'Hello',
        createdAt: '2026-10-26T18:00:00.000Z',
        editedAt: null,
      },
    ],
  };
  const live = { searching: false, paging: false };
  assert({
    given: 'the newest page, a search, an older page and an empty conversation',
    should: 'read through the newest sequence only on the newest page',
    actual: [
      readThroughSequence(history, live),
      readThroughSequence(history, { ...live, searching: true }),
      readThroughSequence(history, { ...live, paging: true }),
      readThroughSequence({ ...history, messages: [] }, live),
    ],
    expected: [7, null, null, null],
  });
});
