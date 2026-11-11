import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const declaration =
  /CREATE FUNCTION public\.daisy_authorization_accounts_v2\([\s\S]*?\$authorization_accounts\$;/;
const migrations = join(import.meta.dir, '../migrations');

test('the account fence source is the function the migrations install', () => {
  const installed = readdirSync(migrations)
    .sort()
    .map((tag) => {
      try {
        return readFileSync(join(migrations, tag, 'migration.sql'), 'utf8');
      } catch {
        return '';
      }
    })
    .flatMap((sql) => declaration.exec(sql)?.[0] ?? [])
    .at(-1);
  assert({
    given: 'the canonical account fence and the newest migration creating it',
    should:
      'be the same function, so the restriction rule is the one SQL function',
    actual: declaration.exec(
      readFileSync(
        join(import.meta.dir, 'authorization-account-fence.sql'),
        'utf8',
      ),
    )?.[0],
    expected: installed,
  });
});
