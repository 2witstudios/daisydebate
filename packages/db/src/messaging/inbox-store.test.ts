import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createMessagingInboxStore } from './inbox-store';
setupRitewayBun();
test('inbox collection refusal prevents candidate discovery and successful discovery returns no content', async () => {
  const actorId = 'a'.repeat(24),
    userId = 'u'.repeat(24),
    channelId = 'c'.repeat(24);
  const phases: string[] = [];
  let candidateSql = '';
  const tx = {
    execute: async (query: SQL) => {
      const statement = new PgDialect().sqlToQuery(query).sql;
      if (statement.includes('daisy_authorization_accounts')) {
        phases.push('account');
        return [{ actorId, userId, revision: 1, member: true, erased: false }];
      }
      phases.push('candidates');
      candidateSql = statement;
      return [{ channelId }];
    },
  };
  const database = {
    transaction: async (work: (value: typeof tx) => Promise<unknown>) =>
      work(tx),
  } as unknown as BunSQLDatabase;
  const scope = { actorId, userId, limit: 4 };
  const denied = createMessagingInboxStore(database, async () => {
    phases.push('deny');
    throw createAppError('AUTHORIZATION');
  });
  await assertRejects({
    given: 'an unapproved collection',
    should: 'refuse before querying associations',
    actual: () => denied.candidates(scope),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'the refusal',
    should: 'hold only account authority',
    actual: phases.splice(0),
    expected: ['account', 'deny'],
  });
  const allowed = createMessagingInboxStore(database, async (frame) => {
    phases.push('authorize');
    assert({
      given: 'the collection fence',
      should: 'bind the same transaction and current self account',
      actual: [frame.tx === tx, frame.account?.actorId],
      expected: [true, actorId],
    });
  });
  assert({
    given: 'a current approved own collection',
    should: 'return candidate IDs only',
    actual: await allowed.candidates(scope),
    expected: [channelId],
  });
  assert({
    given: 'candidate discovery',
    should: 'follow account and canonical authorization',
    actual: phases,
    expected: ['account', 'authorize', 'candidates'],
  });
  assert({
    given: 'saved own associations and explicit hidden preferences',
    should:
      'discover candidates without treating following as authority and omit only own hidden selections',
    actual: [
      candidateSql.includes('messaging_actor_states'),
      candidateSql.includes('hidden = true'),
      candidateSql.includes('following = true'),
    ],
    expected: [true, true, false],
  });
});
