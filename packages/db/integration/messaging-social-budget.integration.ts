import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  friendCommand,
  openPairStore,
  socialLimits,
} from './messaging-pair-store.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

type Store = Awaited<ReturnType<typeof openPairStore>>;

/** One friendship change by `self`, read and committed under the pair lock. */
const change = (
  { frameFor }: Store,
  self: readonly [string, string],
  next: 'request' | 'decline' | 'accept',
  now: string,
) =>
  frameFor(self[0], self[1], async (frame) => {
    const { pair, otherActorId } = await frame.readFriendship();
    await frame.commitFriendship({
      ...friendCommand(),
      previous: pair,
      next:
        next === 'decline'
          ? null
          : {
              state: next === 'request' ? 'pending' : 'accepted',
              requesterActorId: next === 'request' ? self[0] : otherActorId,
            },
      now,
    });
  });

const declinesOf = async (client: SQL, decliner: string) =>
  (await client.unsafe(
    'select declined_count::int as "count", blocked_until is not null as "blocked" from messaging_social_declines where decliner_actor_id=$1',
    [decliner],
  )) as { count: number; blocked: boolean }[];

const day = (offset: number) =>
  new Date(
    Date.parse('2026-10-09T18:00:00.000Z') + offset * 86_400_000,
  ).toISOString();

test('three declines by one person block the requester for 30 days, and acceptance clears them (DEC-251)', async () => {
  const store = await openPairStore(databaseUrl);
  const { client, fixture } = store;
  const asker = [fixture.actorId!, fixture.userId!] as const;
  const answerer = [fixture.otherActorId!, fixture.otherUserId!] as const;
  try {
    for (const offset of [0, 1]) {
      await change(store, asker, 'request', day(offset));
      await change(store, answerer, 'decline', day(offset));
    }
    const afterTwo = await declinesOf(client, answerer[0]);
    await change(store, asker, 'request', day(2));
    await change(store, answerer, 'decline', day(2));
    const afterThree = await declinesOf(client, answerer[0]);
    await assertRejects({
      given: 'a fourth request inside the block',
      should: 'refuse it exactly as a block is refused',
      actual: () => change(store, asker, 'request', day(3)),
      code: 'AUTHORIZATION',
    });
    await change(store, answerer, 'request', day(3));
    await change(store, asker, 'accept', day(3));
    assert({
      given:
        'two declines, a third, then the decliner asking and the requester accepting',
      should:
        'count the first two, block on the third, and delete the pair’s declines on acceptance',
      actual: [afterTwo, afterThree, await declinesOf(client, answerer[0])],
      expected: [
        [{ count: 2, blocked: false }],
        [{ count: 0, blocked: true }],
        [],
      ],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});

test('a block lapses after 30 days, and a decline older than 30 days no longer counts', async () => {
  const store = await openPairStore(databaseUrl);
  const { client, fixture } = store;
  const asker = [fixture.actorId!, fixture.userId!] as const;
  const answerer = [fixture.otherActorId!, fixture.otherUserId!] as const;
  try {
    for (const offset of [0, 1, 2]) {
      await change(store, asker, 'request', day(offset));
      await change(store, answerer, 'decline', day(offset));
    }
    await change(store, asker, 'request', day(33));
    await change(store, answerer, 'decline', day(33));
    const afterLapse = await declinesOf(client, answerer[0]);
    await change(store, asker, 'request', day(70));
    await change(store, answerer, 'decline', day(70));
    assert({
      given:
        'a request after the block ends, and a decline more than 30 days after the last one',
      should: 'accept the request and start each count over',
      actual: [afterLapse, await declinesOf(client, answerer[0])],
      expected: [
        [{ count: 1, blocked: false }],
        [{ count: 1, blocked: false }],
      ],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});

test('the request budgets count the ledger, never the current pair rows (DEC-251)', async () => {
  const store = await openPairStore(databaseUrl);
  const { client, fixture } = store;
  const asker = [fixture.actorId!, fixture.userId!] as const;
  const now = day(0);
  const spent = async (count: number, unrelated: boolean, at: string) => {
    for (let index = 0; index < count; index += 1)
      await client.unsafe(
        "insert into messaging_social_commands(actor_id,request_id,counterpart_actor_id,kind,created_at,unrelated) values($1,$2,$3,'friend.request',$4::timestamptz,$5)",
        [asker[0], createId(), fixture.otherActorId, at, unrelated],
      );
  };
  const clear = () =>
    client.unsafe('delete from messaging_social_commands where actor_id=$1', [
      asker[0],
    ]);
  try {
    await spent(socialLimits.unrelatedHourly, true, day(-0.01));
    await assertRejects({
      given: 'five unrelated requests in the last hour',
      should: 'refuse a sixth to an account with no relation',
      actual: () => change(store, asker, 'request', now),
      code: 'RATE_LIMIT',
    });
    await clear();
    await spent(socialLimits.daily, false, day(-0.5));
    await assertRejects({
      given: 'twenty related requests in the last day',
      should: 'refuse the twenty-first, however related',
      actual: () => change(store, asker, 'request', now),
      code: 'RATE_LIMIT',
    });
    await clear();
    await spent(socialLimits.daily, true, day(-1.1));
    await change(store, asker, 'request', now);
    const [ledger] = (await client.unsafe(
      "select unrelated from messaging_social_commands where actor_id=$1 and created_at=$2::timestamptz and kind='friend.request'",
      [asker[0], now],
    )) as { unrelated: boolean }[];
    assert({
      given: 'only requests older than a day, then a first request',
      should:
        'spend it and snapshot that the recipient had no relation when asked',
      actual: ledger?.unrelated,
      expected: true,
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});
