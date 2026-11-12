import { assert, setupRitewayBun, test } from 'riteway/bun';
import { submitContextChatChange } from '../context-chat/change-form';
import { submitContextChatMessage } from '../context-chat/form';
import { contextChatIdle } from '../context-chat/form-state';
import {
  parseContextChatDiscovery,
  parseContextChatMetadata,
} from '../context-chat/view';
import { roundFloorContext } from '../round-floor/floor-context';
import { roomChatContext } from './room-chat-context';

setupRitewayBun();
const roomId = 'r'.repeat(24);
const channelId = 'c'.repeat(24);
const requestId = 'q'.repeat(24);
const messageId = 'm'.repeat(24);
const wire = {
  version: 1,
  roomId,
  channelId,
  readOnly: false,
  expiresAt: null,
};
const metadata = {
  version: 1,
  ownerId: roomId,
  channelId,
  readOnly: false,
  expiresAt: null,
};

test('Room chat metadata is the Room’s own wire', () => {
  assert({
    given:
      'Room chat metadata for this Room, for another Room, in the floor’s shape, and read as the floor would',
    should: 'accept only the Room’s own field naming the requested Room',
    actual: [
      parseContextChatMetadata(roomChatContext, wire, roomId),
      parseContextChatMetadata(roomChatContext, wire, 'x'.repeat(24)),
      parseContextChatMetadata(
        roomChatContext,
        { ...wire, roomId: undefined, roundId: roomId },
        roomId,
      ),
      parseContextChatMetadata(
        roomChatContext,
        { ...wire, roundId: roomId },
        roomId,
      ),
      parseContextChatMetadata(roundFloorContext, wire, roomId),
    ],
    expected: [metadata, null, null, null, null],
  });
});

test('Room chat discovery says whether a channel exists, for this Room alone', () => {
  assert({
    given:
      'a discovery with no channel, with this Room’s channel, with a channel of another Room and for another Room',
    should: 'accept the first two and refuse the mismatched ones',
    actual: [
      parseContextChatDiscovery(
        roomChatContext,
        { version: 1, roomId, channel: null },
        roomId,
      ),
      parseContextChatDiscovery(
        roomChatContext,
        { version: 1, roomId, channel: wire },
        roomId,
      ),
      parseContextChatDiscovery(
        roomChatContext,
        {
          version: 1,
          roomId,
          channel: { ...wire, roomId: 'x'.repeat(24) },
        },
        roomId,
      ),
      parseContextChatDiscovery(
        roomChatContext,
        { version: 1, roomId: 'x'.repeat(24), channel: null },
        roomId,
      ),
    ],
    expected: [{ channel: null }, { channel: metadata }, null, null],
  });
});

const draft = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
};

test('Room chat forms post to the Room’s chat address', async () => {
  const urls: string[] = [];
  const answer = (status: number) => async (url: string) => {
    urls.push(url);
    return new Response('{}', { status });
  };
  const refused = await submitContextChatMessage(
    roomChatContext,
    answer(404),
    { ownerId: roomId, channelId },
    contextChatIdle(requestId),
    draft({ text: 'Hello', requestId }),
    () => 'n'.repeat(24),
  );
  const forbidden = await submitContextChatMessage(
    roomChatContext,
    answer(403),
    { ownerId: roomId, channelId },
    contextChatIdle(requestId),
    draft({ text: 'Hello', requestId }),
    () => 'n'.repeat(24),
  );
  for (const [kind, report] of [
    ['edit', false],
    ['remove', false],
    ['report', true],
  ] as const)
    await submitContextChatChange(
      roomChatContext,
      (_kind, url) => answer(404)(url),
      { ownerId: roomId, channelId },
      contextChatIdle(requestId),
      draft({
        kind,
        messageId,
        requestId,
        text: 'Changed',
        reason: 'spam',
      }),
      () => 'n'.repeat(24),
      report,
    );
  assert({
    given: 'a refused send, edit, removal and report from the Room page',
    should:
      'have posted each to this Room’s chat route and name Room chat in what the sender is told',
    actual: [
      urls,
      refused.kind === 'refused' ? refused.error : null,
      forbidden.kind === 'refused' ? forbidden.error : null,
    ],
    expected: [
      [
        `/api/rooms/${roomId}/chat/messages`,
        `/api/rooms/${roomId}/chat/messages`,
        `/api/rooms/${roomId}/chat/edit`,
        `/api/rooms/${roomId}/chat/remove`,
        `/api/rooms/${roomId}/chat/report`,
      ],
      'This Room chat is unavailable. Your draft is kept.',
      'You cannot send to this Room chat now. Your draft is kept.',
    ],
  });
});
