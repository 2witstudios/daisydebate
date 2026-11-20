import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createMessagingPrivacyAdopter } from '../messaging/privacy';
import {
  runPrivacyErasure,
  runPrivacyExport,
  type PrivacyVerificationBinding,
} from './operations';
import type { Tx, TxOpener } from '../tx';

setupRitewayBun();

const subject = {
  userId: 'abcdefghijklmnopqrstuvwx',
  actorId: 'bcdefghijklmnopqrstuvwxy',
};

function messagingExportDatabase(
  inputFiles: readonly Readonly<Record<string, unknown>>[],
) {
  const dialect = new PgDialect();
  const statements: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: async (statement: SQL) => {
      const query = dialect.sqlToQuery(statement);
      statements.push(query);
      if (query.sql.includes('daisy_authorization_accounts'))
        return [
          {
            userId: subject.userId,
            actorId: subject.actorId,
            member: true,
            betaState: 'approved',
            betaRevision: 1,
            ageBand: 'adult',
            restricted: false,
            erased: false,
            revision: 1,
          },
        ];
      if (query.sql.includes('from users where id'))
        return [
          {
            id: subject.userId,
            username: 'subject',
            email: 'subject@example.test',
            email_verified: true,
            name: 'Subject',
            image: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
            version: 1,
            deleted_at: null,
          },
        ];
      if (query.sql.includes('from messaging_files')) {
        const actorId = query.params.find((value) => value === subject.actorId);
        return inputFiles
          .filter((row) => row.owner_actor_id === actorId)
          .map((row) => {
            const projection = { ...row };
            delete projection.object_key;
            return projection;
          });
      }
      return [];
    },
  } as unknown as Tx;
  const database = {
    transaction: async <T>(work: (transaction: Tx) => Promise<T>) => work(tx),
  } as unknown as TxOpener;
  return { database, statements };
}

test('canonical export accepts an empty MSG file projection', async () => {
  const { database } = messagingExportDatabase([]);
  const result = await runPrivacyExport(database, subject, [
    createMessagingPrivacyAdopter(),
  ]);
  assert({
    given: 'a subject with no messaging file rows',
    should: 'return the required empty file table projection',
    actual: result.messaging_files,
    expected: [],
  });
});

test('verification cleanup rejects noncanonical bindings before any transaction', async () => {
  let transactions = 0;
  const database = {
    transaction: async () => {
      transactions++;
      throw new Error('transaction must not run');
    },
  } as unknown as TxOpener;
  const bad: readonly (readonly PrivacyVerificationBinding[])[] = [
    [{ purpose: ' sign-in ', subject: 'email' }],
    [{ jsonTypes: [' registration '], subjectPath: ['userData', 'id'] }],
    [{ jsonTypes: ['registration'], subjectPath: [' userData ', 'id'] }],
    [
      { purpose: 'sign-in', subject: 'email' },
      { purpose: ' sign-in ', subject: 'email' },
    ],
    [],
  ];
  for (const binding of bad)
    await assertRejects({
      given:
        'noncanonical whitespace or missing verification producer bindings',
      should: 'refuse cleanup instead of leaving pending subject tokens alive',
      actual: () =>
        runPrivacyErasure(
          database,
          {
            subject,
            now: '2026-10-09T18:00:00.000Z',
            vendors: [],
            jobIds: [],
          },
          [],
          binding,
        ),
      code: 'VALIDATION',
    });
  assert({
    given: 'all rejected verification binding manifests',
    should: 'perform no database operation',
    actual: transactions,
    expected: 0,
  });
});
