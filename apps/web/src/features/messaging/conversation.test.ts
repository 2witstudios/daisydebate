import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  readConversationResponse,
  readThroughSequence,
  conversationNames,
  conversationPageAdmission,
} from './conversation';
setupRitewayBun();
test('conversation wire responses require authorized configured bounds and coherent portable history', async () => {
  assert({
    given: 'a refused history read',
    should: 'provide no content to the conversation',
    actual: await readConversationResponse(new Response(null, { status: 403 })),
    expected: { kind: 'unavailable' },
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

test('conversation page admission decides both required reads together', () => {
  const ready = { kind: 'ready' } as const;
  const denied = { kind: 'unavailable' } as const;
  const temporary = { kind: 'temporary', retryAfterMs: 1000 } as const;
  assert({
    given: 'every pair of ready, temporary and permanent required page reads',
    should:
      'stop on either permanent refusal and honor the slower temporary advice',
    actual: [ready, temporary, denied].flatMap((history) =>
      [ready, { ...temporary, retryAfterMs: 2000 }, denied].map((entry) =>
        conversationPageAdmission(history, entry),
      ),
    ),
    expected: [
      ready,
      { kind: 'temporary', retryAfterMs: 2000 },
      denied,
      temporary,
      { kind: 'temporary', retryAfterMs: 2000 },
      denied,
      denied,
      denied,
      denied,
    ],
  });
});

test('conversation refusal preserves only explicit temporary admission advice', async () => {
  const responses = [
    new Response(null, { status: 503, headers: { 'retry-after': '1' } }),
    new Response(null, { status: 503 }),
    ...[429, 403, 404].map(
      (status) =>
        new Response(null, { status, headers: { 'retry-after': '1' } }),
    ),
    ...['0', '-1', 'NaN', '1000000', '0x1', '1e0', '+1', '1.0'].map(
      (delay) =>
        new Response(null, { status: 503, headers: { 'retry-after': delay } }),
    ),
  ];
  assert({
    given:
      'an advised admission refusal, bare outage, rate/authority denial and invalid advice',
    should: 'permit recovery only for the bounded advised temporary503',
    actual: await Promise.all(responses.map(readConversationResponse)),
    expected: [
      { kind: 'temporary', retryAfterMs: 1000 },
      ...Array.from({ length: 12 }, () => ({ kind: 'unavailable' })),
    ],
  });
});

test('authorized conversation carries only the explicitly supplied typing recovery interval', async () => {
  const history = {
    version: 1,
    channelId: 'c'.repeat(24),
    changeVersion: 0,
    messages: [],
    nextBefore: null,
    viewer: { readSequence: 0, firstUnreadSequence: null, ownReactions: [] },
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
    actual: [
      supplied.kind === 'ready' ? supplied.typingRefetchMs : null,
      absent.kind === 'ready' ? absent.typingRefetchMs : null,
    ],
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
        reactions: [],
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

test('a conversation page names its counterpart, not "Participant" (ISSUE-605)', () => {
  const base = {
    channelId: 'c'.repeat(24),
    preview: null,
    activityAt: '2026-10-27T12:00:00.000Z',
    unread: false,
  };
  assert({
    given:
      'a DM with a named counterpart, one with a deleted account, and a group',
    should:
      'title the page and label the other author by @username, or say who is gone, and title a group by name',
    actual: [
      conversationNames({ ...base, kind: 'conversation', title: 'ada' }),
      conversationNames({ ...base, kind: 'conversation', title: null }),
      conversationNames({
        ...base,
        kind: 'group_conversation',
        title: 'Debate club',
      }),
      conversationNames(null),
    ],
    expected: [
      { title: '@ada', otherAuthor: '@ada', username: 'ada', isGroup: false },
      {
        title: 'Deleted account',
        otherAuthor: 'Deleted account',
        username: null,
        isGroup: false,
      },
      {
        title: 'Debate club',
        otherAuthor: 'Member',
        username: null,
        isGroup: true,
      },
      {
        title: 'Conversation',
        otherAuthor: 'Member',
        username: null,
        isGroup: false,
      },
    ],
  });
});
