import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { corpusScripts } from './bot-corpus-cases.test-support';
import { recordCorpus } from './bot-corpus.test-support';

setupRitewayBun();

/**
 * The bot corpus (R4.3): every scripted round's log across the bot's edge,
 * committed while it passed on the publisher and speaker as they were at
 * `bfb17fa8d`. `GOLDEN_UPDATE=1` rewrites it; a rewrite of the bot must not.
 */
const root = join(import.meta.dir, 'corpus');
const updating = process.env['GOLDEN_UPDATE'] === '1';
const scripts = corpusScripts();
const fileOf = (name: string) =>
  `${name
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()}.log`;

const readCase = (file: string): string | null => {
  try {
    return readFileSync(join(root, file), 'utf8');
  } catch {
    return null;
  }
};

describe('the bot corpus (R4.3)', () => {
  test('holds exactly the scripted rounds', async () => {
    if (updating) {
      // Every log is recorded before the committed ones are replaced.
      const logs: [string, string][] = [];
      for (const script of scripts)
        logs.push([fileOf(script.name), await recordCorpus(script)]);
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });
      for (const [file, log] of logs) writeFileSync(join(root, file), log);
    }
    assert({
      given: 'the corpus folder',
      should: 'hold one log per scripted round and nothing else',
      actual: readdirSync(root).sort(),
      expected: scripts.map(({ name }) => fileOf(name)).sort(),
    });
  });

  for (const script of scripts)
    test(script.name, async () => {
      const file = fileOf(script.name);
      assert({
        given: `the scripted round ${file}`,
        should: 'log the same calls at the same instants as the committed log',
        actual: await recordCorpus(script),
        expected: readCase(file),
      });
    });
});
