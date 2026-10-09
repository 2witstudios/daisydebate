import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createMessagingChannelAuthority } from './authority-frame';
import { messagingAuthorityFixture } from './social.test-support';
setupRitewayBun();
for (const [changed, locked] of [
  [false, true],
  [true, true],
  [false, false],
] as const) {
  test(`minimal channel fence ${!locked ? 'refuses absent authority' : changed ? 'refuses member drift' : 'rereads facts after ordered locks'}`, async () => {
    const fact = messagingAuthorityFixture();
    if (fact.authority.kind !== 'dm') throw new Error('DM fixture required');
    const actorId = fact.authority.lowActorId;
    const userId = 'u'.repeat(24);
    const statements: string[] = [];
    let reads = 0,
      used = 0;
    const dialect = new PgDialect();
    const tx = {
      execute: async (query: SQL) => {
        const text = dialect.sqlToQuery(query).sql;
        statements.push(text);
        if (text.includes('jsonb_build_object')) {
          reads += 1;
          return [
            {
              fact:
                reads === 2 && changed
                  ? {
                      ...fact,
                      authority: {
                        ...fact.authority,
                        highActorId: 'd'.repeat(24),
                      },
                    }
                  : fact,
            },
          ];
        }
        if (text.includes('daisy_authorization_accounts'))
          return [
            { actorId, userId, member: true, erased: false, revision: 9 },
          ];
        return [{ locked }];
      },
    };
    const database = {
      transaction: async (work: (value: typeof tx) => Promise<unknown>) =>
        work(tx),
    } as unknown as BunSQLDatabase;
    const read = createMessagingChannelAuthority(database);
    const work = async (frame: Parameters<Parameters<typeof read>[1]>[0]) => {
      used += 1;
      assert({
        given: 'minimal authority after waits',
        should:
          'bind current accounts and the same transaction without content',
        actual: [
          frame.tx === tx,
          frame.accounts[0]?.revision,
          Object.keys(frame).sort(),
        ],
        expected: [true, 9, ['accounts', 'fact', 'tx']],
      });
    };
    if (!locked)
      await assertRejects({
        given: 'a missing or mismatched lock selector',
        should: 'refuse without protected fact replay',
        actual: () =>
          read({ actorId, userId, channelId: fact.channelId }, work),
        code: 'NOT_FOUND',
      });
    else if (changed)
      await assertRejects({
        given: 'a cast identity changed while locking',
        should: 'refuse before handing facts to the consumer',
        actual: () =>
          read({ actorId, userId, channelId: fact.channelId }, work),
        code: 'CONFLICT',
      });
    else await read({ actorId, userId, channelId: fact.channelId }, work);
    assert({
      given: 'the authority read transaction',
      should:
        'discover, lock accounts then pair/channel, and reread without message/title columns',
      actual: [
        statements.map((text) =>
          text.includes('jsonb_build_object')
            ? 'fact'
            : text.includes('daisy_authorization_accounts')
              ? 'account'
              : 'fence',
        ),
        statements.some((text) =>
          /messaging_messages|\btitle\b|select \*/i.test(
            text.replace(
              'select * from public.daisy_authorization_accounts',
              '',
            ),
          ),
        ),
        used,
      ],
      expected: [
        locked
          ? ['fact', 'account', 'fence', 'fact']
          : ['fact', 'account', 'fence'],
        false,
        changed || !locked ? 0 : 1,
      ],
    });
  });
}
