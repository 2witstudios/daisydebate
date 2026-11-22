import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createFriendStore, type FriendFrame } from '../src/friends';
import { contactReactions } from '../src/contact-composition';
import { createMessagingTestFixture } from '../src/testing';
import { SQL } from 'bun';
import { friendCommand } from './contact-pair-store.test-support';
import { publicLobbyId } from '../src/daisy-reference';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('friendship writes recheck account authority, preserve unrelated Challenges, and count only actual declines', async () => {
  const client = new SQL(url);
  const fixture = await createMessagingTestFixture(client);
  const another = await createMessagingTestFixture(client);
  const { actorId, userId, otherActorId, otherUserId, low, high, now } =
    fixture;
  const neighbour = another.actorId;
  const [neighbourLow, neighbourHigh] = [otherActorId, neighbour].sort();
  const statements: string[] = [];
  let fences = 0;
  const database = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query.trim()) },
  });
  const store = createFriendStore({
    database,
    reactions: contactReactions,
    authorize: async () => {
      fences++;
    },
  });
  const use = <T>(peer: boolean, work: (frame: FriendFrame) => Promise<T>) =>
    store.withContacts(
      {
        actorId: peer ? otherActorId : actorId,
        userId: peer ? otherUserId : userId,
        memberActorIds: [actorId, otherActorId],
      },
      work,
    );
  const write = (
    peer: boolean,
    next: Parameters<FriendFrame['commitFriendship']>[0]['next'],
  ) =>
    use(peer, async (frame) => {
      const read = await frame.readFriendship();
      const previous = read.pair;
      const request = friendCommand();
      const before = fences;
      await frame.commitFriendship({ ...request, previous, next, now });
      assert({
        given: 'a commit in the real friend contact frame',
        should: 'reauthorize the specific mutation',
        actual: fences - before,
        expected: 1,
      });
      return { read, requestId: request.requestId };
    });
  const declineCount = async () =>
    (
      await client`select declined_count from social_request_declines where decliner_actor_id=${otherActorId} and requester_actor_id=${actorId}`
    )[0]?.declined_count ?? null;
  const pending = { state: 'pending' as const, requesterActorId: actorId };
  const accepted = { state: 'accepted' as const, requesterActorId: actorId };
  const challenge = createId();
  try {
    await client`update messaging_dm_pairs set request_state='declined', decided_at=${now} where channel_id=${fixture.channelId}`;
    await client`insert into contact_pairs(low_actor_id,high_actor_id) values(${neighbourLow},${neighbourHigh})`;
    await client`insert into friendships(low_actor_id,high_actor_id,requester_actor_id,state,requested_at,accepted_at) values(${neighbourLow},${neighbourHigh},${neighbour},'accepted',${now},${now})`;
    await client`insert into challenges(id,challenger_actor_id,challenged_actor_id,mode,format_id,lobby_id,created_at,expires_at) values(${challenge},${actorId},${otherActorId},'casual','freestyle',${publicLobbyId},${now},${now}::timestamptz+interval '1 hour')`;
    const asked = await write(false, pending);
    const counts = await use(true, (frame) => frame.readFriendship());
    const locked = statements.some(
      (query) =>
        query.includes('from "friendships"') && query.endsWith('for update'),
    );
    await write(false, null);
    const cancelled = await declineCount();
    await write(false, pending);
    await write(true, null);
    const declined = await declineCount();
    await write(false, pending);
    await write(true, accepted);
    const settled = await declineCount();
    await write(false, null);
    const [state] =
      await client`select exists(select 1 from friendships where low_actor_id=${low} and high_actor_id=${high}) as friendship, exists(select 1 from challenges where id=${challenge}) as challenge, (select unrelated from social_requests where request_id=${asked.requestId}) as unrelated`;
    assert({
      given:
        'a real active friendship, request cancellation, actual decline, reacceptance and friendship removal',
      should:
        'lock projected counts, count only the decline, clear it on acceptance, retain the Challenge, and record an unrelated request',
      actual: [counts, locked, cancelled, declined, settled, state],
      expected: [
        {
          otherActorId: actorId,
          pair: pending,
          actorPendingOutgoing: 0,
          actorFriends: 1,
          otherFriends: 0,
        },
        true,
        null,
        1n,
        null,
        { friendship: false, challenge: true, unrelated: true },
      ],
    });
  } finally {
    await client`delete from challenges where id=${challenge}`;
    await client`delete from friendships where low_actor_id=${neighbourLow} and high_actor_id=${neighbourHigh}`;
    await client`delete from contact_pairs where low_actor_id=${neighbourLow} and high_actor_id=${neighbourHigh}`;
    await another.cleanup();
    await fixture.cleanup();
    await client.close();
  }
});
