import { setDefaultTimeout } from 'bun:test';
import { ESLint } from 'eslint';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();
// The first typed lint builds the whole program: as slow as eslint.config.test.ts.
setDefaultTimeout(180_000);

let shared: ESLint | undefined;
const repositoryEslint = (): ESLint =>
  (shared ??= new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: './eslint.config.mjs',
  }));

/** The no-restricted-syntax messages ESLint reports for `text` at `filePath`. */
const restricted = async (filePath: string, text: string) =>
  (await repositoryEslint().lintText(text, { filePath }))[0]?.messages
    .filter(({ ruleId }) => ruleId === 'no-restricted-syntax')
    .map(({ message }) => message) ?? [];

describe('integration files reach Redis only through the guarded helper (ISSUE-245)', () => {
  test('a raw client, a whole-database scan and FLUSH are each refused in every integration workspace', async () => {
    const bad = [
      "import { RedisClient } from 'bun'; const a = new RedisClient(url);",
      'await deleteKeysWithoutExpiry(client);',
      "await client.send('FLUSHDB', []);",
      "await client.send('flushall', []);",
      "await client.send('SCAN', ['0', 'MATCH', '*']);",
      "await client.send('KEYS', ['*']);",
    ];
    const files = [
      'packages/redis/integration/x.integration.ts',
      'apps/web/integration/x.integration.ts',
      'apps/realtime/integration/x.integration.ts',
    ];

    const reports = await Promise.all(
      files.flatMap((file) => bad.map((text) => restricted(file, text))),
    );

    assert({
      given:
        'a raw Redis client, a whole-database scan, FLUSHDB/FLUSHALL and a scan or KEYS of everything, in each integration workspace',
      should: 'report exactly one restricted-syntax error for each',
      actual: reports.map((messages) => messages.length),
      expected: reports.map(() => 1),
    });
  });

  test('negative control: the guarded helper and namespace-scoped commands are allowed', async () => {
    const messages = await restricted(
      'packages/redis/integration/x.integration.ts',
      "import { openTestRedis } from '@daisy/redis/testing'; const client = openTestRedis(url); await deleteKeysWithoutExpiry(client, `${namespace}:*`); await client.send('KEYS', [`${namespace}:*`]); await client.send('SCAN', ['0', 'MATCH', `${namespace}:*`]);",
    );

    assert({
      given:
        'openTestRedis and a delete, KEYS and SCAN scoped to one namespace',
      should: 'report no restricted-syntax error',
      actual: messages,
      expected: [],
    });
  });

  test('negative control: outside integration files (the runner, slot tooling) a raw client is allowed', async () => {
    const messages = await restricted(
      'scripts/x.ts',
      "import { RedisClient } from 'bun'; const a = new RedisClient(url); await deleteKeysWithoutExpiry(a);",
    );

    assert({
      given: 'the runner’s own use, in scripts/',
      should: 'report no restricted-syntax error',
      actual: messages,
      expected: [],
    });
  });
});
