import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { notificationOperations } from '../src/notifications';
import {
  friendCommand,
  openPairStore,
} from './contact-pair-store.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('a friend request tells the other member, its acceptance tells the asker, and a block takes both away', async () => {
  const { client, database, fixture, frameFor, blockFor } =
    await openPairStore(databaseUrl);
  const { userId, otherUserId, actorId, otherActorId, now } = fixture;
  const notifications = notificationOperations({ database });
  const inbox = async (member: string) =>
    (
      await notifications.readNotifications({
        userId: member,
        unreadOnly: false,
        limit: 10,
        now,
        after: null,
      })
    ).rows.map((row) => row.kind);
  const stored = async () =>
    (
      (await client.unsafe(
        'select count(*)::int as n from notifications where user_id in ($1,$2)',
        [userId, otherUserId],
      )) as { n: number }[]
    )[0]!.n;
  try {
    await frameFor(actorId!, userId!, async (frame) => {
      const facts = await frame.readFriendship();
      await frame.commitFriendship({
        ...friendCommand(),
        previous: facts.pair,
        next: { state: 'pending', requesterActorId: actorId! },
        now,
      });
    });
    const asked = {
      asker: await inbox(userId!),
      other: await inbox(otherUserId!),
    };
    await frameFor(otherActorId!, otherUserId!, async (frame) => {
      const read = await frame.readFriendship();
      await frame.commitFriendship({
        ...friendCommand(),
        previous: read.pair,
        next: { state: 'accepted', requesterActorId: actorId! },
        now,
      });
    });
    const accepted = {
      asker: await inbox(userId!),
      other: await inbox(otherUserId!),
      stored: await stored(),
    };
    await blockFor(
      actorId!,
      userId!,
      { blocked: true, digest: 'd'.repeat(64) },
      now,
    );
    assert({
      given: 'a friend request, its acceptance, then a block',
      should:
        'show the request to the other member, then only the acceptance to the asker, then keep neither row',
      actual: { asked, accepted, blocked: await stored() },
      expected: {
        asked: { asker: [], other: ['friend_request_received'] },
        accepted: {
          asker: ['friend_request_accepted'],
          other: [],
          stored: 2,
        },
        blocked: 0,
      },
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});
