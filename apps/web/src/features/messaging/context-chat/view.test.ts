import { assert, setupRitewayBun, test } from 'riteway/bun';
import { testChatContext } from './chat-context.test-support';
import { parseContextChatMetadata } from './view';
setupRitewayBun();
const roundId = 'r'.repeat(24);
const channelId = 'c'.repeat(24);
const metadata = {
  version: 1,
  roundId,
  channelId,
  readOnly: false,
  expiresAt: null,
};
test('chat metadata is scoped to the requested Round', () => {
  assert({
    given: 'valid metadata',
    should: 'accept the expected Round only',
    actual: [
      parseContextChatMetadata(testChatContext, metadata, roundId),
      parseContextChatMetadata(testChatContext, metadata, 'x'.repeat(24)),
    ],
    expected: [
      {
        version: 1,
        ownerId: roundId,
        channelId,
        readOnly: false,
        expiresAt: null,
      },
      null,
    ],
  });
});
test('chat metadata refuses malformed retention dates and identifiers', () => {
  assert({
    given: 'untrusted metadata',
    should: 'refuse invalid boundaries',
    actual: [
      parseContextChatMetadata(
        testChatContext,
        { ...metadata, expiresAt: 'never' },
        roundId,
      ),
      parseContextChatMetadata(
        testChatContext,
        { ...metadata, channelId: '../' },
        roundId,
      ),
    ],
    expected: [null, null],
  });
});

test('chat history refuses a valid message page borrowed from another channel', async () => {
  const { readContextChatResponse } = await import('./view');
  const response = (channel: string) =>
    new Response(
      JSON.stringify({
        version: 1,
        roundId,
        metadata,
        history: {
          version: 1,
          channelId: channel,
          changeVersion: 0,
          messages: [],
          nextBefore: null,
          viewer: {
            readSequence: 0,
            firstUnreadSequence: null,
            ownReactions: [],
          },
        },
        authors: [],
      }),
      {
        headers: {
          'x-messaging-message-units': '4000',
          'x-messaging-page-items': '100',
        },
      },
    );
  assert({
    given: 'an authorized response envelope',
    should: 'accept only the requested channel throughout the envelope',
    actual: [
      Boolean(
        await readContextChatResponse(
          testChatContext,
          response(channelId),
          roundId,
          channelId,
        ),
      ),
      await readContextChatResponse(
        testChatContext,
        response('x'.repeat(24)),
        roundId,
        channelId,
      ),
    ],
    expected: [true, null],
  });
});

test('a read marker answer is this channel’s, in the shape the route gives', async () => {
  const { parseContextChatReadMark } = await import('./view');
  const marked = { version: 1, channelId, sequence: 7 };
  assert({
    given:
      'the route’s answer, another channel’s, one with no number, another version and one with more than was asked',
    should: 'give the marked sequence for the first alone',
    actual: [
      parseContextChatReadMark(marked, channelId),
      parseContextChatReadMark(marked, 'x'.repeat(24)),
      parseContextChatReadMark({ ...marked, sequence: '7' }, channelId),
      parseContextChatReadMark({ ...marked, version: 2 }, channelId),
      parseContextChatReadMark({ ...marked, text: 'hello' }, channelId),
      parseContextChatReadMark(null, channelId),
    ],
    expected: [7, null, null, null, null, null],
  });
});
