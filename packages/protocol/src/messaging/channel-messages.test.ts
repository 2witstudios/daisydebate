import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  channelMessagesWindow,
  createChannelMessagesProjector,
  type ChannelMessageRecord,
} from './channel-messages';

setupRitewayBun();
const channelId = 'c'.repeat(24);
const record = (
  sequence: number,
  text: string | null = `m${sequence}`,
): ChannelMessageRecord => ({
  id: `m${String(sequence).padStart(23, '0')}`,
  channelId,
  authorActorId: 'a'.repeat(24),
  sequence,
  changeVersion: sequence,
  text,
  createdAt: '2026-10-28T00:00:00.000Z',
  editedAt: null,
  removedAt: null,
});
const project = createChannelMessagesProjector({
  messageUnits: 4000,
  pageItems: 100,
});
const newestFirst = (count: number, text?: (n: number) => string) =>
  Array.from({ length: count }, (_, index) =>
    record(count - index, text?.(count - index)),
  );

describe('channel messages projector', () => {
  test('latest window with older history', () => {
    const page = project({
      channelId,
      changeVersion: 60,
      records: newestFirst(51),
      limit: 50,
    });
    assert({
      given: 'limit + 1 rows',
      should: 'return limit messages and continue after the last',
      actual: [page.messages.length, page.nextBefore],
      expected: [50, { channelId, sequence: 2 }],
    });
  });
  test('removed message', () => {
    const page = project({
      channelId,
      changeVersion: 3,
      records: [{ ...record(1), removedAt: '2026-10-28T00:00:01.000Z' }],
      limit: 50,
    });
    assert({
      given: 'a removed message',
      should: 'disclose only its position',
      actual: page.messages[0],
      expected: {
        id: record(1).id,
        channelId,
        sequence: 1,
        changeVersion: 1,
        unavailable: true,
      },
    });
  });
  test('byte budget', () => {
    const page = project({
      channelId,
      changeVersion: 50,
      records: newestFirst(50, () => '\u0001'.repeat(4000)),
      ...channelMessagesWindow,
    });
    const bytes = new TextEncoder().encode(
      JSON.stringify(page.messages),
    ).length;
    assert({
      given: '50 maximum-size escaped messages',
      should:
        'end the page at the last complete message within the frame budget and continue after it',
      actual: [
        page.messages.length < 50,
        bytes <= channelMessagesWindow.byteBudget,
        page.messages.every((m) => 'text' in m && m.text.length === 4000),
        page.nextBefore?.sequence === page.messages.at(-1)?.sequence,
      ],
      expected: [true, true, true, true],
    });
  });
  test('all history fits', () => {
    assert({
      given: 'fewer rows than the limit',
      should: 'not continue',
      actual: project({
        channelId,
        changeVersion: 2,
        records: newestFirst(2),
        limit: 50,
      }).nextBefore,
      expected: null,
    });
  });
});
