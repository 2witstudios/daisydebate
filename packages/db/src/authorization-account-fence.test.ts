import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  committedMigrationSql,
  installedFunction,
} from './migrations.test-support';

setupRitewayBun();

const family = 'daisy_authorization_accounts_v';

/** The newest version of the fence any text defines. */
const newestName = (sql: string) => {
  const versions = [
    ...sql.matchAll(
      new RegExp(
        `CREATE (?:OR REPLACE )?FUNCTION public\\.${family}(\\d+)\\(`,
        'gi',
      ),
    ),
  ].map(([, version]) => Number(version));
  return versions.length === 0
    ? undefined
    : `${family}${Math.max(...versions)}`;
};

/** A definition's header as PostgreSQL keeps it, however it is spelled. */
const header = (statement: string) => {
  const head = statement.slice(0, statement.search(/\bAS\s+\$/i));
  const flat = head.replace(/"/g, '').replace(/\s+/g, ' ').toLowerCase();
  const args = /\(([^)]*)\)\s*returns/.exec(flat)?.[1]?.replace(/\s/g, '');
  const returns = /returns table\s*\(([^)]*)\)/
    .exec(flat)?.[1]
    ?.replace(/\s/g, '');
  const searchPath = /set search_path (?:=|to) ([^\n]*?)(?: as|$)/
    .exec(flat)?.[1]
    ?.replace(/'/g, '')
    .split(',')
    .map((schema) => schema.trim());
  return {
    args,
    returns,
    language: /language (\w+)/.exec(flat)?.[1],
    securityDefiner: flat.includes('security definer'),
    searchPath,
  };
};

test('the account fence source is the function the migrations install', async () => {
  const migrated = await committedMigrationSql();
  const name = newestName(migrated);
  const source = readFileSync(
    join(import.meta.dir, 'authorization-account-fence.sql'),
    'utf8',
  );
  const installed = name ? installedFunction(migrated, name) : undefined;
  const canonical = name ? installedFunction(source, name) : undefined;
  assert({
    given:
      'the canonical account fence and the newest fence version the migrations create',
    should:
      'be that same version, with the same signature, security attributes and body, so the restriction rule is the one SQL function',
    actual: {
      sourceName: newestName(source),
      header: canonical && header(canonical.statement),
      body: canonical?.body === installed?.body,
      // Never a vacuous match: both headers must parse.
      parsed:
        installed !== undefined &&
        header(installed.statement).args !== undefined &&
        header(installed.statement).returns !== undefined,
    },
    expected: {
      sourceName: name,
      header: installed && header(installed.statement),
      body: true,
      parsed: true,
    },
  });
});
