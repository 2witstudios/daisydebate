import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { openMessagingFixture } from './messaging-fixture.test-support';
import { friendshipPolicy } from '../src/features/messaging/friends/friendship';
import {
  blockContact,
  friendChange,
  raceBehindAccountLock,
  removeMembers,
  seedFriendships,
  seedMembers,
  settle,
  type Opened,
} from './friendship-races.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const friendshipRows = (opened: Opened) =>
  opened.client.unsafe(
    'select state from messaging_friendships where low_actor_id=$1 and high_actor_id=$2',
    [opened.fixture.low, opened.fixture.high],
  ) as Promise<{ state: string }[]>;

const participants = (opened: Opened) => ({
  sender: opened.principal,
  recipient: {
    kind: 'user' as const,
    userId: opened.fixture.otherUserId!,
    actorId: opened.fixture.otherActorId!,
  },
  // The fixture names each user after its id.
  senderName: opened.fixture.userId!,
  recipientName: opened.fixture.otherUserId!,
});

const close = async (opened: Opened) => {
  await opened.fixture.cleanup();
  await opened.database.close();
  await opened.client.close();
};

const countFriendships = async (
  opened: Opened,
  where: string,
): Promise<number> => {
  const [row] = (await opened.client.unsafe(
    `select count(*)::int as count from messaging_friendships where ${where}`,
    [opened.fixture.actorId],
  )) as { count: number }[];
  return row!.count;
};

test('simultaneous reciprocal requests become one friendship (ADR 0072)', async () => {
  const opened = await openMessagingFixture(databaseUrl);
  const change = friendChange(opened);
  const { sender, recipient, senderName, recipientName } = participants(opened);
  try {
    // Unserialized, both would read no row and both insert; the loser would
    // then fail on the primary key rather than accept. The shared account
    // lock is what orders them here.
    const answers = await raceBehindAccountLock(opened.client, sender.userId, [
      () => settle(change(sender, 'request', recipientName)),
      () => settle(change(recipient, 'request', senderName)),
    ]);
    assert({
      given: 'two members asking each other on separate connections at once',
      should:
        'serialize on the pair and end with exactly one accepted friendship',
      actual: [
        [...answers].sort(),
        (await friendshipRows(opened)).map((row) => row.state),
      ],
      expected: [['friends', 'outgoing'], ['accepted']],
    });
  } finally {
    await close(opened);
  }
});

test('a block racing a fresh request leaves no friendship', async () => {
  const opened = await openMessagingFixture(databaseUrl);
  const change = friendChange(opened);
  const { sender, recipient, senderName } = participants(opened);
  try {
    // Unserialized, the block would find no row to delete while the request
    // inserts one past it; the shared account lock orders them instead.
    const [requested, block] = await raceBehindAccountLock(
      opened.client,
      sender.userId,
      [
        () => settle(change(recipient, 'request', senderName)),
        () => blockContact(opened, sender, recipient.actorId),
      ],
    );
    assert({
      given:
        'a request and a block of the same pair at once, with no prior row',
      should:
        'either request then delete, or refuse the request without naming the block, and keep no friendship',
      actual: [
        ['outgoing', 'NOT_FOUND'].includes(requested),
        block.blocked,
        await friendshipRows(opened),
      ],
      expected: [true, true, []],
    });
  } finally {
    // The fixture's cleanup removes the block's command receipt too.
    await close(opened);
  }
});

test('a block racing an acceptance leaves no friendship', async () => {
  const opened = await openMessagingFixture(databaseUrl);
  const change = friendChange(opened);
  const { sender, recipient, senderName, recipientName } = participants(opened);
  try {
    await change(sender, 'request', recipientName);
    const [accepted, block] = await raceBehindAccountLock(
      opened.client,
      sender.userId,
      [
        () => settle(change(recipient, 'accept', senderName)),
        () => blockContact(opened, sender, recipient.actorId),
      ],
    );
    assert({
      given: 'an acceptance and a block of the same pair at once',
      should:
        'either accept then delete, or refuse the acceptance without naming the block, and keep no friendship',
      actual: [
        ['friends', 'NOT_FOUND'].includes(accepted),
        block.blocked,
        await friendshipRows(opened),
      ],
      expected: [true, true, []],
    });
  } finally {
    await close(opened);
  }
});

test('the last outgoing request is granted once under concurrency', async () => {
  const opened = await openMessagingFixture(databaseUrl);
  const change = friendChange(opened);
  const { sender } = participants(opened);
  const { client, fixture } = opened;
  const asked = friendshipPolicy.maxPendingOutgoing - 1;
  const members = await seedMembers(client, asked + 2, { now: fixture.now });
  try {
    await seedFriendships(client, fixture.actorId!, members.slice(0, asked), {
      state: 'pending',
      requesterActorId: () => fixture.actorId!,
      now: fixture.now,
    });
    const answers = await raceBehindAccountLock(
      client,
      sender.userId,
      members
        .slice(asked)
        .map(
          (member) => () => settle(change(sender, 'request', member.userId)),
        ),
    );
    assert({
      given: `a member one request below the ${friendshipPolicy.maxPendingOutgoing}-request limit asking two more at once`,
      should: 'grant exactly one and refuse the other as a limit',
      actual: [
        [...answers].sort(),
        await countFriendships(
          opened,
          "requester_actor_id=$1 and state='pending'",
        ),
      ],
      expected: [
        ['RATE_LIMIT', 'outgoing'],
        friendshipPolicy.maxPendingOutgoing,
      ],
    });
  } finally {
    await removeMembers(client, members);
    await close(opened);
  }
});

test('the last friend place is granted once under concurrency', async () => {
  const opened = await openMessagingFixture(databaseUrl);
  const change = friendChange(opened);
  const { sender, senderName } = participants(opened);
  const { client, fixture } = opened;
  const befriended = friendshipPolicy.maxFriends - 1;
  const friends = await seedMembers(client, befriended, { now: fixture.now });
  const accepting = await seedMembers(client, 2, {
    adult: true,
    now: fixture.now,
  });
  try {
    await seedFriendships(client, fixture.actorId!, friends, {
      state: 'accepted',
      requesterActorId: () => fixture.actorId!,
      now: fixture.now,
    });
    await seedFriendships(client, fixture.actorId!, accepting, {
      state: 'pending',
      requesterActorId: () => fixture.actorId!,
      now: fixture.now,
    });
    // Two different pairs: only the asker's account lock serializes them.
    const answers = await raceBehindAccountLock(
      client,
      sender.userId,
      accepting.map(
        (member) => () =>
          settle(
            change(
              { kind: 'user', userId: member.userId, actorId: member.actorId },
              'accept',
              senderName,
            ),
          ),
      ),
    );
    assert({
      given: `a member one friend below the ${friendshipPolicy.maxFriends}-friend limit whose two requests are accepted at once`,
      should: 'accept exactly one and refuse the other as a limit',
      actual: [
        [...answers].sort(),
        await countFriendships(
          opened,
          "(low_actor_id=$1 or high_actor_id=$1) and state='accepted'",
        ),
      ],
      expected: [['RATE_LIMIT', 'friends'], friendshipPolicy.maxFriends],
    });
  } finally {
    await removeMembers(client, [...friends, ...accepting]);
    await close(opened);
  }
});
