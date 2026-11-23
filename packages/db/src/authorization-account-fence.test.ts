import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  committedMigrationSql,
  installedFunction,
} from './migrations.test-support';

setupRitewayBun();

const name = 'daisy_authorization_accounts_v2';

test('the account fence source is the function the migrations install', async () => {
  const installed = installedFunction(await committedMigrationSql(), name);
  const source = installedFunction(
    readFileSync(
      join(import.meta.dir, 'authorization-account-fence.sql'),
      'utf8',
    ),
    name,
  );
  assert({
    given: 'the canonical account fence and the newest migration creating it',
    should:
      'have the same body, so the restriction rule is the one SQL function',
    actual: [typeof installed?.body, source?.body === installed?.body],
    expected: ['string', true],
  });
});
