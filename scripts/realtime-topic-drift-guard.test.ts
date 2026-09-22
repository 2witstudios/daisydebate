import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

/**
 * PageSpace's realtime service built room names by hand across dozens of
 * call sites; this scan is the guard against the same drift here. It only
 * scans the two apps that speak the realtime protocol: any hand-built
 * `debate:`, `user:` or `standings:` prefix outside `@daisy/protocol`
 * itself means a caller bypassed the topic builders in `@daisy/protocol`'s
 * `realtime` module. It lives here, in the root script tier, because
 * `packages/protocol` may never import `node:fs` (it stays framework- and
 * I/O-free, including in its own tests).
 */
const repoRoot = path.resolve(import.meta.dir, '..');
const scanTargets = ['apps/web', 'apps/realtime'];
const FAMILY = '(?:debate|user|standings)';
/**
 * Matches a topic prefix immediately followed by string interpolation or
 * concatenation, in every form seen in review: template-literal
 * interpolation, quote/backtick concatenation with `+`, `.concat(...)`, an
 * array literal starting with the bare family name fed to `.join(...)`, and
 * a template literal with a placeholder fed to `.replace(...)`. Deliberately
 * narrower than "any `debate:` substring": permission strings such as
 * `'debate:create'` are a single literal token with no interpolation,
 * concatenation, `.concat`, `.join` or `.replace` nearby, so they never
 * match.
 */
const handBuiltTopicPattern = new RegExp(
  [
    `\`${FAMILY}:\\$\\{`, // `debate:${...}`
    `['"\`]${FAMILY}:['"\`]\\s*\\+`, // 'debate:' + ... / `debate:` + ...
    `['"\`]${FAMILY}:['"\`]\\s*\\.concat\\(`, // 'debate:'.concat(...)
    `\\[\\s*['"\`]${FAMILY}['"\`]\\s*,[^\\]]*\\]\\s*\\.join\\(`, // ['debate', id].join(...)
    `\`${FAMILY}:[^\`]*\`\\s*\\.replace\\(`, // `debate:%s`.replace(...)
  ].join('|'),
);

async function findHandBuiltTopics(appPath: string): Promise<string[]> {
  const dir = path.join(repoRoot, appPath);
  if (!existsSync(dir)) return [];
  const glob = new Bun.Glob('**/*.{ts,tsx,js,mjs}');
  const hits: string[] = [];
  for await (const relativePath of glob.scan({ cwd: dir, dot: false })) {
    if (relativePath.split(path.sep).includes('node_modules')) continue;
    const contents = await readFile(path.join(dir, relativePath), 'utf8');
    if (handBuiltTopicPattern.test(contents))
      hits.push(path.join(appPath, relativePath));
  }
  return hits;
}

describe('realtime topic drift guard', () => {
  test('scans apps/web and apps/realtime, skipping either directory only if it does not exist yet', async () => {
    const hits = (
      await Promise.all(scanTargets.map(findHandBuiltTopics))
    ).flat();
    assert({
      given: 'every existing app that speaks the realtime protocol',
      should: 'contain no hand-built debate/user/standings topic strings',
      actual: hits,
      expected: [],
    });
  });

  test('the detector itself is a real scan, not a silent pass: it flags every known hand-built form and clears a builder call', () => {
    const handBuilt = [
      'const topic = `debate:${debateId}:presence`;', // template-literal interpolation
      "const topic = 'user:' + id + ':inbox';", // quote concatenation
      'const topic = `debate:` + id;', // backtick concatenation
      "const topic = ['debate', id].join(':');", // array + .join
      "const topic = 'standings:'.concat(season);", // .concat
      'const topic = `debate:%s`.replace("%s", id);', // template + .replace
    ];
    assert({
      given: 'every hand-built topic form seen in review',
      should: 'match the drift-guard pattern',
      actual: handBuilt.map((source) => handBuiltTopicPattern.test(source)),
      expected: handBuilt.map(() => true),
    });
    assert({
      given:
        'source using the shared builder from @daisy/protocol, and an unrelated permission string',
      should: 'not match the drift-guard pattern',
      actual: [
        handBuiltTopicPattern.test(
          'const topic = buildDebatePresenceTopic(debateId);',
        ),
        handBuiltTopicPattern.test(
          "requirePermission(principal, 'debate:create');",
        ),
      ],
      expected: [false, false],
    });
  });
});
