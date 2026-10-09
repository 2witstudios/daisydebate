import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { AuthorizationTransaction } from '../authorization';
import { createMessagingPrivacyAdopter } from '../messaging/privacy';
import { messagingPrivacyExpectedColumns } from './messaging-declarations';
import {
  erasePrivacySubject,
  exportPrivacySubject,
  type PrivacyVerificationBinding,
} from './operations';

setupRitewayBun();

const subject = {
  userId: 'abcdefghijklmnopqrstuvwx',
  actorId: 'bcdefghijklmnopqrstuvwxy',
};

function messagingExportDatabase(
  inputFiles: readonly Readonly<Record<string, unknown>>[],
  includeObjectKey = false,
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
            erased: false,
            revision: 1,
          },
        ];
      if (query.sql.includes('from users u join actors'))
        return [
          {
            userId: subject.userId,
            actorId: subject.actorId,
            actorKind: 'human',
            actorUserId: subject.userId,
            username: 'subject',
            emailVerified: true,
            deletedAt: null,
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
            if (!includeObjectKey) delete projection.object_key;
            return projection;
          });
      }
      return [];
    },
  } as unknown as AuthorizationTransaction;
  const database = {
    transaction: async <T>(
      work: (transaction: AuthorizationTransaction) => Promise<T>,
    ) => work(tx),
  } as unknown as Pick<BunSQLDatabase, 'transaction'>;
  return { database, statements };
}

const ownFile = {
  id: 'own-file',
  channel_id: 'owned-channel',
  owner_actor_id: subject.actorId,
  filename: 'subject.png',
  object_key: 'internal-object-key',
};

test('canonical export accepts the MSG adopter own file projection only', async () => {
  const { database, statements } = messagingExportDatabase([
    ownFile,
    {
      ...ownFile,
      id: 'foreign-file',
      owner_actor_id: 'cdefghijklmnopqrstuvwxyz',
    },
  ]);
  const result = await exportPrivacySubject(database, subject, {
    requiredAdopters: [
      {
        id: 'messaging',
        phase: 'before-auth',
        expectedColumns: messagingPrivacyExpectedColumns,
      },
    ],
    adopters: [createMessagingPrivacyAdopter()],
  });
  const filesQuery = statements.find((statement) =>
    statement.sql.includes('from messaging_files'),
  );
  assert({
    given: 'an actual messaging adopter with owned and foreign file rows',
    should:
      'return only the bound actor projection and allow MSG to own messaging_files',
    actual: [
      result.messaging_files,
      /where owner_actor_id\s*=\s*\$\d+/.test(filesQuery?.sql ?? ''),
      filesQuery?.params.includes(subject.actorId),
    ],
    expected: [
      [
        {
          id: 'own-file',
          channel_id: 'owned-channel',
          owner_actor_id: subject.actorId,
          filename: 'subject.png',
        },
      ],
      true,
      true,
    ],
  });
  assert({
    given: 'MSG file export projection',
    should: 'exclude its internal object key from canonical output',
    actual: Object.hasOwn(result.messaging_files?.[0] ?? {}, 'object_key'),
    expected: false,
  });
});

test('canonical export rejects an MSG projection that leaks object_key', async () => {
  const { database } = messagingExportDatabase([ownFile], true);
  await assertRejects({
    given: 'a malformed messaging adopter projection containing object_key',
    should: 'fail closed through canonical declaration validation',
    actual: () =>
      exportPrivacySubject(database, subject, {
        requiredAdopters: [
          {
            id: 'messaging',
            phase: 'before-auth',
            expectedColumns: messagingPrivacyExpectedColumns,
          },
        ],
        adopters: [createMessagingPrivacyAdopter()],
      }),
    code: 'VALIDATION',
  });
});

test('canonical export accepts an empty MSG file projection', async () => {
  const { database } = messagingExportDatabase([]);
  const result = await exportPrivacySubject(database, subject, {
    requiredAdopters: [
      {
        id: 'messaging',
        phase: 'before-auth',
        expectedColumns: messagingPrivacyExpectedColumns,
      },
    ],
    adopters: [createMessagingPrivacyAdopter()],
  });
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
  } as unknown as Pick<BunSQLDatabase, 'transaction'>;
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
        erasePrivacySubject(
          database,
          {
            subject,
            now: '2026-10-09T18:00:00.000Z',
            vendors: [],
            jobIds: [],
          },
          { requiredAdopters: [], adopters: [] },
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
