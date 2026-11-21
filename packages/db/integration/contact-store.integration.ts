import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { contactReactions } from '../src/contact-composition';
import { challengeContactReactions } from '../src/challenges/frame';
import { createContactStore } from '../src/contacts/store';
import { createMessagingTestFixture } from '../src/testing';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('contact updates keep the opposite direction and bind the receipt without a DM', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const [low, high] = [fixture.low, fixture.high];
  if (!low || !high) throw new Error('Missing fixture pair');
  const userId =
    high === fixture.actorId ? fixture.userId : fixture.otherUserId;
  const scope = { userId, actorId: high, memberActorIds: [high, low] };
  const requestId = createId();
  const digest = 'd'.repeat(64);
  const statements: string[] = [];
  const database = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query) },
  });
  const received: unknown[] = [];
  const authorize: Parameters<
    typeof createContactStore
  >[0]['authorize'] = async (_tx, input, fact) => {
    received.push([
      input.actorId,
      fact.accounts.map((account) => account?.actorId),
    ]);
  };
  const store = createContactStore({
    database,
    authorize,
    reactions: contactReactions,
  });
  try {
    await client`delete from messaging_channels where id=${fixture.channelId}`;
    await client`update contact_pairs set low_blocks_high=true
      where low_actor_id=${low} and high_actor_id=${high}`;
    const result = await store.withContacts(scope, async (frame) => ({
      blocking: frame.blocking,
      before: await frame.readReceipt(requestId),
      updated: await frame.commitBlock({
        requestId,
        digest,
        blocked: true,
        now: fixture.now,
      }),
    }));
    const [receipt] =
      await client`select actor_id, counterpart_actor_id, kind, digest
      from contact_commands where actor_id=${high} and request_id=${requestId}`;
    const [pair] =
      await client`select low_blocks_high, high_blocks_low, revision::text as revision
      from contact_pairs where low_actor_id=${low} and high_actor_id=${high}`;
    const [bells] =
      await client`select count(*)::int as n from outbox where topic in
      (${`user:${low}:inbox`},${`user:${high}:inbox`})`;
    assert({
      given:
        'the high actor’s block when the low actor already blocks and no DM exists',
      should:
        'fence both accounts, preserve the opposite direction, bind the receipt and avoid inbox activity',
      actual: {
        result,
        receipt,
        pair,
        authorization: received,
        bells: bells.n,
      },
      expected: {
        result: {
          blocking: false,
          before: null,
          updated: { blocked: true, revision: Number(pair.revision) },
        },
        receipt: {
          actor_id: high,
          counterpart_actor_id: low,
          kind: 'contact.block',
          digest,
        },
        pair: {
          low_blocks_high: true,
          high_blocks_low: true,
          revision: pair.revision,
        },
        authorization: Array.from({ length: 3 }, () => [high, [low, high]]),
        bells: 0,
      },
    });
    assert({
      given: 'the actual contact fence statements',
      should: 'take account locks before the pair update',
      actual:
        statements.findIndex((query) =>
          query.includes('daisy_authorization_accounts'),
        ) < statements.findIndex((query) => query.includes('for update')),
      expected: true,
    });
    statements.length = 0;
    for (const input of [
      { ...scope, memberActorIds: [low, low] },
      { ...scope, actorId: createId() },
      { ...scope, memberActorIds: [high] },
    ])
      await assertRejects({
        given: 'a duplicate, unrelated or incomplete pair proposal',
        should: 'refuse the scope',
        actual: () =>
          store.withContacts(input, async () => {
            throw new Error('Invalid scope reached the consumer');
          }),
        code: 'VALIDATION',
      });
    assert({
      given: 'the invalid scopes',
      should: 'run no SQL',
      actual: statements,
      expected: [],
    });
    await assertRejects({
      given: 'a well-formed actor with no durable account',
      should: 'withhold the contact frame',
      actual: () =>
        store.withContacts(
          { ...scope, memberActorIds: [high, createId()] },
          async () => {
            throw new Error('Missing account reached the consumer');
          },
        ),
      code: 'NOT_FOUND',
    });
    statements.length = 0;
    const denied = createContactStore({
      database,
      reactions: contactReactions,
      authorize: async () => {
        throw createAppError('AUTHORIZATION');
      },
    });
    await assertRejects({
      given: 'the current pair with a fresh authorization denial',
      should: 'withhold the command frame',
      actual: () =>
        denied.withContacts(scope, async () => {
          throw new Error('Denied scope reached the consumer');
        }),
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'the current denial',
      should: 'avoid reading or writing receipts',
      actual: statements.some((query) => query.includes('contact_commands')),
      expected: false,
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});

test('an actual challenge is deleted only by the block reaction', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const { low, high } = fixture;
  if (!low || !high) throw new Error('Missing fixture pair');
  const id = createId();
  const db = drizzle({ client });
  const pair = { lowActorId: low, highActorId: high };
  try {
    await client`insert into challenges
      (id,challenger_actor_id,challenged_actor_id,mode,format_id,division,created_at,expires_at)
      values(${id},${low},${high},'casual','freestyle','open',${fixture.now},'2026-10-09T19:00:00Z')`;
    const remaining = async () =>
      (await client`select id from challenges where id=${id}`).length;
    await challengeContactReactions.onBlock(db, pair, false);
    const afterUnblock = await remaining();
    await challengeContactReactions.onBlock(db, pair, true);
    assert({
      given: 'a stored challenge and the unblock and block reactions',
      should: 'keep the challenge on unblock and remove it on block',
      actual: [afterUnblock, await remaining()],
      expected: [1, 0],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});
