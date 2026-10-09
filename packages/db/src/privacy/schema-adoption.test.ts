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
