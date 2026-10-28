import { assert, setupRitewayBun, test } from 'riteway/bun';
import { channelWire } from './channel-wire.test-support';
import { createMessagingFileStore } from './file-store';
setupRitewayBun();

const fencesOf = (queries: readonly { readonly query: string }[]) => ({
  sharedAccounts: queries.some((q) =>
    q.query.includes('daisy_authorization_read_accounts_v2('),
  ),
  sharedChannel: queries.some((q) =>
    q.query.includes('daisy_messaging_channel_read_fence('),
  ),
  exclusiveChannel: queries.some((q) =>
    q.query.includes('daisy_messaging_channel_fence('),
  ),
  streamLock: queries.some(
    (q) =>
      q.query.includes('from messaging_channel_streams') &&
      q.query.trim().endsWith('for update'),
  ),
});

test('file reads and posts share the authority fences; only posting locks the stream (MSG-2.1-arch1, MSG-2.2-arch1)', async () => {
  const runs = await Promise.all(
    (['read', 'post'] as const).map(async (capability) => {
      const f = channelWire([]);
      await createMessagingFileStore({
        database: f.database,
        authorize: () => async () => {},
      }).withChannel(f.scope, capability, async () => undefined);
      return fencesOf(f.queries);
    }),
  );
  assert({
    given: 'a file frame opened to read, and one opened to post',
    should:
      'share the account and channel fences for both, and lock the stream row only to post',
    actual: runs,
    expected: [
      {
        sharedAccounts: true,
        sharedChannel: true,
        exclusiveChannel: false,
        streamLock: false,
      },
      {
        sharedAccounts: true,
        sharedChannel: true,
        exclusiveChannel: false,
        streamLock: true,
      },
    ],
  });
});
