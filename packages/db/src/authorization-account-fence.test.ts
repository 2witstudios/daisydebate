import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

/** The fence from its name on, however it was created. */
const declaration =
  /CREATE (?:OR REPLACE )?FUNCTION (public\.daisy_authorization_accounts_v\d+\([\s\S]*?\$authorization_accounts\$;)/i;
const bodyOf = (sql: string) => declaration.exec(sql)?.[1];
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
    .flatMap((sql) => bodyOf(sql) ?? [])
    .at(-1);
  const source = bodyOf(
    readFileSync(
      join(import.meta.dir, 'authorization-account-fence.sql'),
      'utf8',
    ),
  );
  assert({
    given: 'the canonical account fence and the newest migration creating it',
    should:
      'be the same function, so the restriction rule is the one SQL function',
    actual: [typeof installed, source === installed],
    expected: ['string', true],
  });
});
