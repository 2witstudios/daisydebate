import { getTableColumns, getTableName } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { users } from '../schema/users';
import { privacyJobs } from '../schema/privacy-jobs';
import { corePrivacyFields } from './core-declarations';
import { validatePrivacyAdoption } from './declarations';

setupRitewayBun();
test('core privacy declarations match actual current schema columns', () => {
  const expected = Object.fromEntries(
    [users, privacyJobs].map((table) => [
      getTableName(table),
      Object.values(getTableColumns(table)).map((column) => column.name),
    ]),
  );
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
  const social = await import('../schema/messaging-social');
  const messages = await import('../schema/messaging-messages');
  const { messagingPrivacyFields } = await import('./messaging-declarations');
  const tables = [
    ...Object.values(channels),
    ...Object.values(social),
    ...Object.values(messages),
  ];
  const expected = Object.fromEntries(
    tables.map((table) => [
      getTableName(table),
      Object.values(getTableColumns(table)).map((column) => column.name),
    ]),
  );
  assert({
    given: 'MSG dedicated social/channel/message producer schema',
    should: 'declare the exact real table and column set with policy holds',
    actual: validatePrivacyAdoption(expected, messagingPrivacyFields),
    expected: { problems: [], activationHeld: true },
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
});
