import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingTestFixture } from '../src/testing';
import { createMessagingSocialStore } from '../src/messaging';
import type { MessagingSocialFrame } from '../src/messaging/social-contracts';
import { listMessagingFriendships } from '../src/messaging/friendships';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const rowsOf = async (client: SQL, low: string, high: string) =>
  (await client.unsafe(
    'select requester_actor_id as "requester", state, accepted_at is not null as "accepted" from messaging_friendships where low_actor_id=$1 and high_actor_id=$2',
    [low, high],
  )) as { requester: string; state: string; accepted: boolean }[];

test('a friendship is asked, accepted, listed both ways and ended by a block (ADR 0072)', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  const { userId, otherUserId, actorId, otherActorId, low, high, now } =
    fixture;
  const store = createMessagingSocialStore({
    database,
    authorize: async () => {},
  });
  const frameFor = <T>(
    self: string,
    selfUser: string,
    work: (frame: MessagingSocialFrame) => Promise<T>,
  ) =>
    store.withContacts(
      {
        actorId: self,
        userId: selfUser,
        memberActorIds: [actorId!, otherActorId!],
      },
      work,
    );
  try {
    await frameFor(actorId!, userId!, async (frame) => {
      const facts = await frame.readFriendship();
      await frame.commitFriendship({
        previous: facts.pair,
        next: { state: 'pending', requesterActorId: actorId! },
        now,
      });
    });
    const asked = await rowsOf(client, low!, high!);
    const facts = await frameFor(otherActorId!, otherUserId!, async (frame) => {
      const read = await frame.readFriendship();
      await frame.commitFriendship({
        previous: read.pair,
        next: { state: 'accepted', requesterActorId: actorId! },
        now,
      });
      return read;
    });
    assert({
      given: 'a request and then the other member’s acceptance',
      should:
        'store one pending pair, read it from the other side with live counts, then accept it',
      actual: [asked, facts, await rowsOf(client, low!, high!)],
      expected: [
        [{ requester: actorId, state: 'pending', accepted: false }],
        {
          otherActorId: actorId,
          pair: { state: 'pending', requesterActorId: actorId },
          actorPendingOutgoing: 0,
          actorFriends: 0,
          otherFriends: 0,
        },
        [{ requester: actorId, state: 'accepted', accepted: true }],
      ],
    });
    const fenced: unknown[] = [];
    const fence: Parameters<typeof listMessagingFriendships>[2] = async ({
      account,
    }) => {
      fenced.push([account?.actorId, account?.member, account?.erased]);
    };
    const mine = await listMessagingFriendships(
      database,
      { userId: userId!, actorId: actorId! },
      fence,
    );
    const theirs = await listMessagingFriendships(
      database,
      { userId: otherUserId!, actorId: otherActorId! },
      fence,
    );
    assert({
      given: 'the accepted pair',
      should:
        'fence each reader on their fresh account and list each member to the other by username',
      actual: [
        fenced,
        mine.map((row) => [row.otherActorId, row.username, row.state]),
        theirs.map((row) => [row.otherActorId, row.username, row.state]),
      ],
      expected: [
        [
          [actorId, true, false],
          [otherActorId, true, false],
        ],
        [[otherActorId, otherUserId, 'accepted']],
        [[actorId, userId, 'accepted']],
      ],
    });
    await frameFor(actorId!, userId!, (frame) =>
      frame.commitBlock({
        requestId: createId(),
        blocked: true,
        digest: 'd'.repeat(64),
        now,
      }),
    );
    const afterBlock = await rowsOf(client, low!, high!);
    await frameFor(actorId!, userId!, (frame) =>
      frame.commitBlock({
        requestId: createId(),
        blocked: false,
        digest: 'e'.repeat(64),
        now,
      }),
    );
    assert({
      given: 'a block and then an unblock',
      should: 'delete the friendship and never restore it',
      actual: [afterBlock, await rowsOf(client, low!, high!)],
      expected: [[], []],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});

test('the friendship row refuses an inconsistent state', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const { actorId, low, high, now } = fixture;
  const refused = async (state: string, acceptedAt: string | null) => {
    try {
      await client.unsafe(
        'insert into messaging_friendships(low_actor_id,high_actor_id,requester_actor_id,state,requested_at,accepted_at) values($1,$2,$3,$4,$5,$6)',
        [low, high, actorId, state, now, acceptedAt],
      );
      await client.unsafe(
        'delete from messaging_friendships where low_actor_id=$1 and high_actor_id=$2',
        [low, high],
      );
      return false;
    } catch {
      return true;
    }
  };
  try {
    assert({
      given:
        'a pending row with an acceptance time, an accepted row without one and an unknown state',
      should: 'refuse each one',
      actual: [
        await refused('pending', now),
        await refused('accepted', null),
        await refused('blocked', null),
        await refused('pending', null),
      ],
      expected: [true, true, true, false],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});
