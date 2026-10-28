import { getTableColumns, getTableName } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { users } from '../schema/users';
import { privacyJobs } from '../schema/privacy-jobs';
import { corePrivacyFields } from './core-declarations';
import { validatePrivacyAdoption } from '@daisy/protocol/privacy';

setupRitewayBun();

/** Each table's actual column names, keyed by table name. */
const currentColumns = (
  tables: readonly Parameters<typeof getTableName>[0][],
) =>
  Object.fromEntries(
    tables.map((table) => [
      getTableName(table),
      Object.values(getTableColumns(table)).map((column) => column.name),
    ]),
  );
test('core privacy declarations match actual current schema columns', () => {
  const expected = currentColumns([users, privacyJobs]);
  assert({
    given: 'actual users and privacy_jobs Drizzle schema',
    should:
      'require exact typed declarations while unresolved legal policies hold activation',
    actual: validatePrivacyAdoption(expected, corePrivacyFields),
    expected: { problems: [], activationHeld: true },
  });
});

test('dedicated MSG declarations match all actual producer columns', async () => {
  const channels = await import('../schema/messaging-channels');
  const files = await import('../schema/messaging-files');
  const social = await import('../schema/messaging-social');
  const subjects = await import('../schema/messaging-social-command-subjects');
  const messages = await import('../schema/messaging-messages');
  const { messagingPrivacyFields, messagingPrivacyExpectedColumns } =
    await import('./messaging-declarations');
  const tables = [
    ...Object.values(channels),
    ...Object.values(files),
    ...Object.values(social),
    ...Object.values(subjects),
    ...Object.values(messages),
  ];
  const expected = currentColumns(tables);
  assert({
    given: 'MSG dedicated social/channel/message producer schema',
    should: 'declare the exact real table and column set with policy holds',
    actual: validatePrivacyAdoption(expected, messagingPrivacyFields),
    expected: { problems: [], activationHeld: true },
  });
  const sortedEntries = (entries: Record<string, readonly string[]>) =>
    Object.entries(entries)
      .map(([table, columns]): [string, string[]] => [
        table,
        [...columns].sort(),
      ])
      .sort(([left], [right]) => left!.localeCompare(right!));
  assert({
    given: 'MSG exact producer schema and canonical adopter manifest',
    should: 'bind each expected table and column to its current source schema',
    actual: sortedEntries(messagingPrivacyExpectedColumns),
    expected: sortedEntries(expected),
  });
  assert({
    given: 'subject authored content and relationship associations',
    should: 'scrub message content and delete personal relationship rows',
    actual: messagingPrivacyFields
      .filter(
        (field) =>
          field.column === 'text' ||
          (field.table === 'messaging_contact_pairs' &&
            field.column === 'low_actor_id'),
      )
      .map((field) => field.erasure),
    expected: ['delete', 'scrub'],
  });
  assert({
    given: 'private messaging file metadata and internal vendor object key',
    should:
      'delete subject file rows while keeping unlinked deletion routing internal',
    actual: messagingPrivacyFields
      .filter((field) => field.table === 'messaging_files')
      .map((field) => [
        field.column,
        field.category,
        field.visibility ?? null,
        field.exportable,
        field.erasure,
      ]),
    expected: [
      ['id', 'identifier', null, true, 'delete'],
      ['object_key', 'identifier', 'private', false, 'delete'],
      ['channel_id', 'personal', 'private', true, 'delete'],
      ['owner_actor_id', 'personal', 'private', true, 'delete'],
      ['request_id', 'personal', 'private', true, 'delete'],
      ['message_id', 'personal', 'private', true, 'delete'],
      ['filename', 'personal', 'private', true, 'delete'],
      ['mime', 'personal', 'private', true, 'delete'],
      ['reserved_bytes', 'personal', 'private', true, 'delete'],
      ['stored_bytes', 'personal', 'private', true, 'delete'],
      ['generation', 'none', null, true, 'delete'],
      ['authority_revision', 'none', null, true, 'delete'],
      ['lifecycle', 'none', null, true, 'delete'],
      ['created_at', 'none', null, true, 'delete'],
      ['expires_at', 'none', null, true, 'delete'],
      ['deleted_at', 'none', null, true, 'delete'],
    ],
  });
  assert({
    given: 'unlinked pending file object deletion intent',
    should:
      'retain only internal object routing and nonpersonal charged bytes until ACK',
    actual: messagingPrivacyFields
      .filter((field) => field.table === 'messaging_file_deletion_intents')
      .map((field) => [
        field.column,
        field.category,
        field.visibility ?? null,
        field.exportable,
        field.erasure,
      ]),
    expected: [
      ['object_key', 'identifier', 'private', false, 'delete'],
      ['charged_bytes', 'none', null, false, 'retain-nonpersonal'],
    ],
  });
  assert({
    given: 'MSG3.1b exact counterpart actor association',
    should:
      'classify the nullable social receipt relationship as private and exportable',
    actual: messagingPrivacyFields.find(
      (field) =>
        field.table === 'messaging_social_commands' &&
        field.column === 'counterpart_actor_id',
    ),
    expected: {
      table: 'messaging_social_commands',
      column: 'counterpart_actor_id',
      category: 'personal',
      visibility: 'private',
      storage: 'postgres',
      owner: 'MSG',
      purpose: 'Subject-directed private communication and social access',
      lawfulBasis: {
        status: 'pending',
        decision: 'jc0qcdvpkmqzrelpaesi3pah',
      },
      retention: {
        status: 'pending',
        decision: 'njiorsf64z4iqjm2dbfa3zuu',
      },
      erasure: 'delete',
      exportable: true,
    },
  });
});

test('canonical pending policies link their owning records', async () => {
  const { messagingPrivacyFields } = await import('./messaging-declarations');
  assert({
    given: 'core and messaging declarations with unresolved legal policies',
    should: 'link exact PRIV inventory and subject-rights policy owners',
    actual: [
      ...new Set(
        [...corePrivacyFields, ...messagingPrivacyFields].map(
          (field) =>
            `${field.lawfulBasis.status}:${field.lawfulBasis.decision}/${field.retention.status}:${field.retention.decision}`,
        ),
      ),
    ],
    expected: [
      'pending:jc0qcdvpkmqzrelpaesi3pah/pending:njiorsf64z4iqjm2dbfa3zuu',
    ],
  });
});

test('multi-target command subjects declare private erasable relationships', async () => {
  const { messagingPrivacyFields } = await import('./messaging-declarations');
  assert({
    given: 'actual creator, request and proposed subject associations',
    should:
      'declare each association private, deletable and subject-exportable',
    actual: messagingPrivacyFields
      .filter((field) => field.table === 'messaging_social_command_subjects')
      .map((field) => [
        field.column,
        field.category,
        field.visibility,
        field.erasure,
        field.exportable,
      ]),
    expected: ['actor_id', 'request_id', 'subject_actor_id'].map((column) => [
      column,
      'personal',
      'private',
      'delete',
      true,
    ]),
  });
});

test('beta access declarations match all actual producer columns', async () => {
  const beta = await import('../schema/beta-access');
  const intents = await import('../schema/mail-intents');
  const operator = await import('../schema/operator-commands');
  const { betaAccessPrivacyFields, betaAccessPrivacyExpectedColumns } =
    await import('./beta-access-declarations');
  const tables = [
    beta.accountBetaAccess,
    beta.accountAccessEvents,
    operator.operatorCommandReceipts,
    intents.mailIntents,
  ];
  const expected = currentColumns(tables);
  assert({
    given: 'the ADR 0075 beta access and mail intent schema',
    should: 'declare the exact real table and column set with policy holds',
    actual: validatePrivacyAdoption(expected, betaAccessPrivacyFields),
    expected: { problems: [], activationHeld: true },
  });
  assert({
    given: 'the beta adopter manifest',
    should: 'name exactly the producer tables',
    actual: Object.keys(betaAccessPrivacyExpectedColumns).sort(),
    expected: Object.keys(expected).sort(),
  });
  assert({
    given: 'subject-owned beta rows and retained operator audit',
    should:
      'delete the access row and mail, and keep only identifiers of the audit',
    actual: [
      ...new Set(
        betaAccessPrivacyFields.map(
          (field) => `${field.table}:${field.erasure}`,
        ),
      ),
    ].sort(),
    expected: [
      'account_access_events:retain-nonpersonal',
      'account_beta_access:delete',
      'mail_intents:delete',
      'operator_command_receipts:retain-nonpersonal',
    ],
  });
});
