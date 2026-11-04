import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingStore } from '../src/messaging';
import { channelObservationReads } from '../src/messaging/observation-reads';
import { createMessagingTestFixture } from '../src/testing';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/** Three messages: one each way and one removed, with reactions on all of them. */
async function seed(client: SQL) {
  const f = await createMessagingTestFixture(client);
  const [theirs, mine, removed, later] = [
    createId(),
    createId(),
    createId(),
    createId(),
  ];
  const rows: readonly (readonly [string, string, number, string | null])[] = [
    [theirs!, f.otherActorId, 1, 'Theirs'],
    [mine!, f.actorId, 2, 'Mine'],
    [removed!, f.otherActorId, 3, null],
    [later!, f.otherActorId, 4, 'Later'],
  ];
  for (const [id, author, sequence, text] of rows)
    await client.unsafe(
      'insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at,removed_at) values($1,$2,$3,$4,$4,$5,$6,$7)',
      [
        id,
        f.channelId,
        author,
        sequence,
        text,
        f.now,
        text === null ? f.now : null,
      ],
    );
  await client.unsafe(
    'update messaging_channel_streams set message_sequence=4,change_version=4 where channel_id=$1',
    [f.channelId],
  );
  const reactions: readonly (readonly [string, string, string])[] = [
    [theirs!, f.actorId, 'A'],
    [theirs!, f.otherActorId, 'A'],
    [theirs!, f.otherActorId, 'B'],
    [mine!, f.otherActorId, 'A'],
    [removed!, f.actorId, 'A'],
  ];
  for (const [messageId, actorId, reaction] of reactions)
    await client.unsafe(
      'insert into messaging_reactions(channel_id,message_id,actor_id,reaction) values($1,$2,$3,$4)',
      [f.channelId, messageId, actorId, reaction],
    );
  return { f, theirs: theirs!, mine: mine!, removed: removed!, later: later! };
}

test('a history page batches shared counts, and only the reader gets their own state', async () => {
  const client = new SQL(databaseUrl);
  const { f, theirs, mine } = await seed(client);
  try {
    const store = createMessagingStore({
      database: drizzle({ client }),
      authorize: async () => {},
    });
    const read = (actorId: string, userId: string) =>
      store.withChannel({ channelId: f.channelId, userId, actorId }, (frame) =>
        frame.history({ limit: 10 }),
      );
    const page = await read(f.actorId, f.userId);
    const counts = page.messages.map((message) => [
      message.sequence,
      message.reactions,
    ]);
    assert({
      given: 'reactions on live messages and on a removed one',
      should:
        'share counts on the live ones in reaction order, none on the removed',
      actual: counts,
      expected: [
        [4, []],
        [3, []],
        [2, [{ reaction: 'A', count: 1 }]],
        [
          1,
          [
            { reaction: 'A', count: 2 },
            { reaction: 'B', count: 1 },
          ],
        ],
      ],
    });
    assert({
      given: 'the same page for its two members',
      should: 'mark each reader only their own, and never a removed message',
      actual: [
        page.viewer.ownReactions,
        (await read(f.otherActorId, f.otherUserId)).viewer.ownReactions,
      ],
      expected: [
        [{ messageId: theirs, reactions: ['A'] }],
        [
          { messageId: mine, reactions: ['A'] },
          { messageId: theirs, reactions: ['A', 'B'] },
        ],
      ],
    });
  } finally {
    await f.cleanup();
    await client.close();
  }
});

test('the reader position skips their own and removed messages', async () => {
  const client = new SQL(databaseUrl);
  const { f } = await seed(client);
  try {
    const store = createMessagingStore({
      database: drizzle({ client }),
      authorize: async () => {},
    });
    const viewer = () =>
      store
        .withChannel(
          { channelId: f.channelId, userId: f.userId, actorId: f.actorId },
          (frame) => frame.history({ limit: 10 }),
        )
        .then((page) => page.viewer);
    const mark = (sequence: number) =>
      store.withChannel(
        { channelId: f.channelId, userId: f.userId, actorId: f.actorId },
        (frame) => frame.markRead(sequence),
      );
    const unread = await viewer();
    await mark(1);
    const pastTheirs = await viewer();
    await mark(4);
    const caughtUp = await viewer();
    assert({
      given: 'a read position moving through their, own and removed messages',
      should: 'name the first live message from someone else past it',
      actual: [unread, pastTheirs, caughtUp].map((state) => [
        state.readSequence,
        state.firstUnreadSequence,
      ]),
      expected: [
        [0, 1],
        [1, 4],
        [4, null],
      ],
    });
  } finally {
    await f.cleanup();
    await client.close();
  }
});

test('the observed window carries counts and names no reactor', async () => {
  const client = new SQL(databaseUrl);
  const { f, theirs, removed } = await seed(client);
  try {
    const window = await client.begin(async (tx) => {
      await tx`set local role daisy_realtime`;
      return channelObservationReads(
        drizzle({ client: tx }),
      ).readChannelObservationWindow(f.channelId, 10);
    });
    const raw = await client.unsafe(
      'select reactions from public.daisy_observation_channel_messages($1::text, 10::integer)',
      [f.channelId],
    );
    const of = (id: string) =>
      window?.records.find((record) => record.id === id)?.reactions;
    assert({
      given: 'a live and a removed message, read as daisy_realtime',
      should: 'return counts for the live one and none for the removed',
      actual: [of(theirs), of(removed)],
      expected: [
        [
          { reaction: 'A', count: 2 },
          { reaction: 'B', count: 1 },
        ],
        [],
      ],
    });
    assert({
      given: 'the function output itself',
      should: 'hold no actor at all',
      actual: [f.actorId, f.otherActorId].some((actor) =>
        JSON.stringify(raw).includes(actor),
      ),
      expected: false,
    });
  } finally {
    await f.cleanup();
    await client.close();
  }
});
