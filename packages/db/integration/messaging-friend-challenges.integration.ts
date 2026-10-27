import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { MessagingSocialFrame } from '../src/messaging/social-contracts';
import { listMessagingFriendChallenges } from '../src/messaging/friendships';
import { Fixture } from './constraint-helpers';
import {
  friendCommand,
  openPairStore,
} from './messaging-pair-store.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('a challenge reaches only its friend while the room is open, and ends with the friendship (ADR 0072)', async () => {
  const { client, database, fixture, frameFor } =
    await openPairStore(databaseUrl);
  const rooms = new Fixture(client);
  const { userId, otherUserId, actorId, otherActorId, now } = fixture;
  const asChallenger = <T>(work: (frame: MessagingSocialFrame) => Promise<T>) =>
    frameFor(actorId!, userId!, work);
  const asFriend = <T>(work: (frame: MessagingSocialFrame) => Promise<T>) =>
    frameFor(otherActorId!, otherUserId!, work);
  const befriend = async () => {
    await asChallenger(async (frame) => {
      const { pair } = await frame.readFriendship();
      await frame.commitFriendship({
        ...friendCommand(),
        previous: pair,
        next: { state: 'pending', requesterActorId: actorId! },
        now,
      });
    });
    await asFriend(async (frame) => {
      const { pair } = await frame.readFriendship();
      await frame.commitFriendship({
        ...friendCommand(),
        previous: pair,
        next: { state: 'accepted', requesterActorId: actorId! },
        now,
      });
    });
  };
  const challenge = (roomId: string) =>
    asChallenger((frame) => frame.commitChallenge({ roomId, now }));
  const listed = async (reader: 'challenger' | 'friend') =>
    (
      await listMessagingFriendChallenges(
        database,
        reader === 'friend'
          ? { userId: otherUserId!, actorId: otherActorId! }
          : { userId: userId!, actorId: actorId! },
        async () => {},
      )
    ).map((row) => [row.roomId, row.username]);
  const stored = async () =>
    (
      (await client.unsafe(
        'select room_id from messaging_friend_challenges where challenger_actor_id = any($1::text[])',
        [`{${actorId},${otherActorId}}`],
      )) as { room_id: string }[]
    ).map((row) => row.room_id);
  const setStatus = (roomId: string, status: string) =>
    client.unsafe('update rooms set status=$2 where id=$1', [roomId, status]);
  try {
    const formatId = await rooms.format();
    const open = await rooms.room(actorId!, formatId);
    const started = await rooms.room(actorId!, formatId, {
      status: 'started',
    });
    const theirs = await rooms.room(otherActorId!, formatId);
    await befriend();
    const refused = [
      await challenge(started),
      await challenge(theirs),
      await challenge(createId()),
    ];
    const recorded = await challenge(open);
    assert({
      given:
        'a started room, a room the friend hosts, an unknown room, then the challenger’s open room',
      should:
        'record only the open room the challenger hosts, listed for the friend and not the challenger',
      actual: [
        refused,
        recorded,
        await listed('friend'),
        await listed('challenger'),
      ],
      expected: [
        [{ recorded: false }, { recorded: false }, { recorded: false }],
        { recorded: true },
        [[open, userId]],
        [],
      ],
    });

    await asChallenger((frame) => frame.declineChallenge({ roomId: open }));
    const afterWrongDecline = await stored();
    await setStatus(open, 'started');
    const whileStarted = await listed('friend');
    await setStatus(open, 'assembling');
    assert({
      given:
        'the challenger declining their own challenge, then the room starting and reopening',
      should:
        'delete nothing, and list the challenge only while the room is open',
      actual: [afterWrongDecline, whileStarted, await listed('friend')],
      expected: [[open], [], [[open, userId]]],
    });

    await asFriend(async (frame) => {
      const { pair } = await frame.readFriendship();
      await frame.commitFriendship({
        ...friendCommand(),
        previous: pair,
        next: null,
        now,
      });
    });
    const afterUnfriend = await stored();
    await befriend();
    assert({
      given:
        'the friend removing the challenger, then the two befriending again',
      should:
        'delete the challenge with the friendship and never bring it back',
      actual: [afterUnfriend, await listed('friend')],
      expected: [[], []],
    });

    await challenge(open);
    await asFriend((frame) =>
      frame.commitBlock({
        requestId: createId(),
        blocked: true,
        digest: 'd'.repeat(64),
        now,
      }),
    );
    const afterBlock = [await stored(), await listed('friend')];
    await asFriend((frame) =>
      frame.commitBlock({
        requestId: createId(),
        blocked: false,
        digest: 'e'.repeat(64),
        now,
      }),
    );
    await befriend();
    await challenge(open);
    await asFriend((frame) => frame.declineChallenge({ roomId: open }));
    assert({
      given:
        'a block of the challenger, then an unblock, a new friendship, a new challenge and the friend declining it',
      should: 'delete the challenge on the block and again on the decline',
      actual: [afterBlock, await stored()],
      expected: [[[], []], []],
    });
  } finally {
    // Rooms go first: they hold the actors the messaging fixture removes.
    await rooms.purge();
    await fixture.cleanup();
    await client.close();
  }
});
