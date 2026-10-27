import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { isAppError } from '@daisy/errors';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { openMessagingFixture } from './messaging-fixture.test-support';
import { changeFriendship } from '../src/features/messaging/friends/operations';
import { friendshipPolicy } from '../src/features/messaging/friends/friendship';
import { blockMessagingContact } from '../src/features/messaging/block';
import { messagingSocialAuthorizationFence } from '../src/features/messaging/social-authorization';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

type Opened = Awaited<ReturnType<typeof openMessagingFixture>>;

/** The real operation, fence and store, as the friend routes compose them. */
const friendChange =
  ({ database, fixture }: Opened) =>
  (
    principal: AuthorizationPrincipal,
    command: Parameters<typeof changeFriendship>[1],
    username: string,
  ) => {
    const clock = { now: () => fixture.now };
    return changeFriendship(principal, command, username, {
      clock,
      limit: async () => {},
      lookup: (name) => database.lookupHumanActorByUsername(name),
      store: (capability) =>
        database.messagingSocialStore(
          messagingSocialAuthorizationFence({
            principal,
            clock,
            operation: { kind: 'friend', capability },
          }),
        ),
    });
  };

/** What a refused change answers: its error code, or the relation it made. */
const settle = async (change: Promise<{ readonly relation: string }>) => {
  try {
    return (await change).relation;
  } catch (error) {
    if (isAppError(error)) return error.code;
    throw error;
  }
};

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

test('simultaneous reciprocal requests become one friendship (ADR 0072)', async () => {
  const opened = await openMessagingFixture(databaseUrl);
  const change = friendChange(opened);
  const { sender, recipient, senderName, recipientName } = participants(opened);
  try {
    const answers = await Promise.all([
      settle(change(sender, 'request', recipientName)),
      settle(change(recipient, 'request', senderName)),
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

test('a block racing an acceptance leaves no friendship', async () => {
  const opened = await openMessagingFixture(databaseUrl);
  const change = friendChange(opened);
  const { sender, recipient, senderName, recipientName } = participants(opened);
  const clock = { now: () => opened.fixture.now };
  try {
    await change(sender, 'request', recipientName);
    const [accepted] = await Promise.all([
      settle(change(recipient, 'accept', senderName)),
      blockMessagingContact(
        {
          version: 1,
          requestId: createId(),
          otherActorId: opened.fixture.otherActorId,
          blocked: true,
        },
        sender,
        {
          bounds: { introductionUnits: 100, titleUnits: 80, batchActors: 10 },
          clock,
          limit: async () => {},
          store: opened.database.messagingSocialStore(
            messagingSocialAuthorizationFence({
              principal: sender,
              clock,
              operation: { kind: 'block' },
            }),
          ),
        },
      ),
    ]);
    assert({
      given: 'an acceptance and a block of the same pair at once',
      should:
        'either accept then delete, or refuse the acceptance without naming the block, and keep no friendship',
      actual: [
        ['friends', 'NOT_FOUND'].includes(accepted),
        await friendshipRows(opened),
      ],
      expected: [true, []],
    });
  } finally {
    // The fixture's cleanup removes the block's command receipt too.
    await close(opened);
  }
});

test('the last outgoing request is granted once under concurrency', async () => {
  const opened = await openMessagingFixture(databaseUrl);
  const change = friendChange(opened);
  const { sender } = participants(opened);
  const { client, fixture } = opened;
  const asked = friendshipPolicy.maxPendingOutgoing - 1;
  const members = Array.from({ length: asked + 2 }, () => ({
    userId: createId(),
    actorId: createId(),
  }));
  try {
    for (const member of members) {
      await client.unsafe(
        'insert into users(id,username,email_verified) values($1,$1,true)',
        [member.userId],
      );
      await client.unsafe(
        "insert into actors(id,kind,user_id) values($1,'human',$2)",
        [member.actorId, member.userId],
      );
    }
    for (const member of members.slice(0, asked)) {
      const [low, high] = [fixture.actorId!, member.actorId].sort();
      await client.unsafe(
        'insert into messaging_contact_pairs(low_actor_id,high_actor_id) values($1,$2)',
        [low, high],
      );
      await client.unsafe(
        "insert into messaging_friendships(low_actor_id,high_actor_id,requester_actor_id,state,requested_at) values($1,$2,$3,'pending',$4)",
        [low, high, fixture.actorId, fixture.now],
      );
    }
    const last = members.slice(asked);
    const answers = await Promise.all(
      last.map((member) => settle(change(sender, 'request', member.userId))),
    );
    const [pending] = (await client.unsafe(
      "select count(*)::int as count from messaging_friendships where requester_actor_id=$1 and state='pending'",
      [fixture.actorId],
    )) as { count: number }[];
    assert({
      given: `a member one request below the ${friendshipPolicy.maxPendingOutgoing}-request limit asking two more at once`,
      should: 'grant exactly one and refuse the other as a limit',
      actual: [[...answers].sort(), pending?.count],
      expected: [
        ['RATE_LIMIT', 'outgoing'],
        friendshipPolicy.maxPendingOutgoing,
      ],
    });
  } finally {
    const actorIds = members.map((member) => member.actorId);
    await client.unsafe(
      'delete from messaging_contact_pairs where low_actor_id = any($1::text[]) or high_actor_id = any($1::text[])',
      [actorIds],
    );
    await client.unsafe('delete from actors where id = any($1::text[])', [
      actorIds,
    ]);
    await client.unsafe('delete from users where id = any($1::text[])', [
      members.map((member) => member.userId),
    ]);
    await close(opened);
  }
});
