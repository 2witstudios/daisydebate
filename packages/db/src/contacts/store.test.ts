import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { contactReactions } from '../contact-composition';
import { createContactStore } from './store';
setupRitewayBun();
const low = 'a'.repeat(24),
  high = 'b'.repeat(24),
  userId = 'u'.repeat(24),
  requestId = 'r'.repeat(24);
const accounts = [
  {
    actorId: low,
    userId: 'v'.repeat(24),
    member: true,
    betaState: 'approved',
    betaRevision: 1,
    ageBand: 'adult',
    erased: false,
    revision: 2,
  },
  {
    actorId: high,
    userId,
    member: true,
    erased: false,
    revision: 3,
    betaState: 'approved',
    betaRevision: 1,
    ageBand: 'adult',
  },
];
const input = { actorId: high, userId, memberActorIds: [high, low] };
test('absent-DM block preserves direct counterpart binding and owns only its directional bit after sorted fences', async () => {
  const { client, queries } = fakeSql([
    accounts,
    [],
    [[low, high, true, false, 7]],
    [['contact.block', 'd'.repeat(64)]],
    [[low, high, true, true, 8]],
    [],
    [],
    [],
    [],
  ]);
  let fences = 0;
  const store = createContactStore({
    reactions: contactReactions,
    database: drizzle({ client }),
    authorize: async (tx, scope, facts) => {
      fences += 1;
      assert({
        given: 'the social authority fence',
        should:
          'receive exact caller, current accounts and canonical pair facts on the caller transaction',
        actual: [
          typeof tx.execute,
          scope.actorId,
          facts.accounts.map((account) => account?.revision),
          facts.contacts,
        ],
        expected: [
          'function',
          high,
          [2, 3],
          [{ lowActorId: low, highActorId: high, blocked: true, revision: 7 }],
        ],
      });
    },
  });
  await store.withContacts(input, async (frame) => {
    assert({
      given: 'the high-side caller',
      should: 'read only its own direction and actor-scoped command receipt',
      actual: [frame.blocking, await frame.readReceipt(requestId)],
      expected: [false, { kind: 'contact.block', digest: 'd'.repeat(64) }],
    });
    assert({
      given: 'a fresh block with no DM channel',
      should: 'change only caller direction and return pair revision',
      actual: await frame.commitBlock({
        requestId,
        blocked: true,
        digest: 'd'.repeat(64),
        now: '2026-10-09T18:00:00.000Z',
      }),
      expected: { blocked: true, revision: 8 },
    });
  });
  const receipt = queries.find((query) =>
    query.query.startsWith('insert into "contact_commands"'),
  );
  const afterReceipt = queries.slice(queries.indexOf(receipt!) + 1);
  assert({
    given:
      'the transaction, the Contacts receipt, then the registered reactions',
    should:
      'lock accounts before the ordered pair, store the explicit counterpart in Contacts’ own receipt, then let Friends end the friendship and Messaging look for a DM, with no outbox',
    actual: [
      fences,
      queries[0]?.query.includes('daisy_authorization_accounts'),
      queries[1]?.params,
      queries[2]?.query.includes('for update'),
      receipt?.params.includes(low),
      afterReceipt.map(
        (query) =>
          query.query.match(
            /^(?:delete from|select .* from) "?([a-z_]+)"?/s,
          )?.[1],
      ),
      queries.some((query) => query.query.includes('"outbox"')),
    ],
    expected: [
      3,
      true,
      [low, high],
      true,
      true,
      ['friendships', 'friend_challenges', 'messaging_dm_pairs'],
      false,
    ],
  });
});
test('invalid social cast refuses before transaction and absent account/pair refuses before consumer', async () => {
  for (const [members, actorId] of [
    [[low, low], low],
    [[low, high], 'z'.repeat(24)],
    [[low], low],
  ] as const) {
    const { client, queries } = fakeSql([]);
    const store = createContactStore({
      reactions: contactReactions,
      database: drizzle({ client }),
      authorize: async () => {},
    });
    await assertRejects({
      given: 'duplicate, outsider or incomplete proposal',
      should: 'refuse malformed pair authority without I/O',
      actual: () =>
        store.withContacts(
          { ...input, actorId, memberActorIds: members },
          async () => {},
        ),
      code: 'VALIDATION',
    });
    assert({
      given: 'invalid scope',
      should: 'not query any durable account',
      actual: queries.length,
      expected: 0,
    });
  }
  for (const script of [[[]], [accounts, [], []]]) {
    const { client } = fakeSql(script);
    let work = 0;
    const store = createContactStore({
      reactions: contactReactions,
      database: drizzle({ client }),
      authorize: async () => {},
    });
    await assertRejects({
      given: 'an unavailable durable account or locked pair',
      should: 'refuse before delivering a social frame',
      actual: () =>
        store.withContacts(input, async () => {
          work += 1;
        }),
      code: 'NOT_FOUND',
    });
    assert({
      given: 'unavailable authority',
      should: 'never invoke command consumer',
      actual: work,
      expected: 0,
    });
  }
});
test('fresh social denial prevents receipt/command access after pair fence', async () => {
  const { client, queries } = fakeSql([
    accounts,
    [],
    [[low, high, false, false, 1]],
  ]);
  let work = 0;
  const store = createContactStore({
    reactions: contactReactions,
    database: drizzle({ client }),
    authorize: async () => {
      throw createAppError('AUTHORIZATION');
    },
  });
  await assertRejects({
    given: 'canonical refusal after ordered current account/pair locks',
    should: 'abort before receipt reading or command mutation',
    actual: () =>
      store.withContacts(input, async () => {
        work += 1;
      }),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'the refusal',
    should: 'expose no frame and create no social command',
    actual: [
      work,
      queries.some((query) => query.query.includes('contact_commands')),
    ],
    expected: [0, false],
  });
});
