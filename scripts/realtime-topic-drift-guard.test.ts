import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

/**
 * PageSpace's realtime service built room names by hand across dozens of
 * call sites; this scan is the guard against the same drift here. It only
 * scans the two apps that speak the realtime protocol: any hand-built
 * `round:`, `user:` or `standings:` prefix outside `@daisy/protocol`
 * itself means a caller bypassed the topic builders `@daisy/protocol`
 * exports. It lives here, in the root script tier, because
 * `packages/protocol` may never import `node:fs` (it stays framework- and
 * I/O-free, including in its own tests).
 */
const repoRoot = path.resolve(import.meta.dir, '..');
const scanTargets = ['apps/web', 'apps/realtime'];
const FAMILY = '(?:round|user|standings)';
/**
 * Matches a topic prefix immediately followed by string interpolation or
 * concatenation, in every form seen in review: template-literal
 * interpolation, quote/backtick concatenation with `+` (both a prefix
 * carrying its own `:` and a bare family literal concatenated with a
 * separate `':'` literal, e.g. `'round' + ':' + id`), `.concat(...)`, an
 * array literal starting with the bare family name fed to `.join(...)`, and
 * a template literal with a placeholder fed to `.replace(...)`. Deliberately
 * narrower than "any `round:` substring": permission strings such as
 * `'round:create'` are a single literal token with no interpolation,
 * concatenation, `.concat`, `.join` or `.replace` nearby, so they never
 * match.
 *
 * Known limits, left as heuristics rather than a parser: it is regex over
 * source text, so it cannot follow a value through a variable
 * (`const p = 'round'; p + ':' + id`), an indirect/computed builder call,
 * or construction spread across multiple statements or files; and it only
 * catches whitespace matched by `\s`, not exotic separators. It scans
 * `apps/web`/`apps/realtime` text, so it also cannot see a topic built at
 * runtime from data (e.g. read from a database column). These bypasses are
 * real, but each one is more expensive to write than calling the builder,
 * which is the property this guard is defending, not proving there is no
 * bypass at all.
 */
const handBuiltTopicPattern = new RegExp(
  [
    `\`${FAMILY}:\\$\\{`, // `round:${...}`
    `['"\`]${FAMILY}:['"\`]\\s*\\+`, // 'round:' + ... / `round:` + ...
    `['"\`]${FAMILY}:['"\`]\\s*\\.concat\\(`, // 'round:'.concat(...)
    `['"\`]${FAMILY}['"\`]\\s*\\+\\s*['"\`]:['"\`]`, // 'round' + ':' + id
    `\\[\\s*['"\`]${FAMILY}['"\`]\\s*,[^\\]]*\\]\\s*\\.join\\(`, // ['round', id].join(...)
    `\`${FAMILY}:[^\`]*\`\\s*\\.replace\\(`, // `round:%s`.replace(...)
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
      should: 'contain no hand-built round/user/standings topic strings',
      actual: hits,
      expected: [],
    });
  });

  test('the detector itself is a real scan, not a silent pass: it flags every known hand-built form and clears a builder call', () => {
    const handBuilt = [
      'const topic = `round:${roundId}:presence`;', // template-literal interpolation
      "const topic = 'user:' + id + ':inbox';", // quote concatenation
      'const topic = `round:` + id;', // backtick concatenation
      "const topic = 'round' + ':' + id;", // bare literal + colon literal
      "const topic = ['round', id].join(':');", // array + .join
      "const topic = 'standings:'.concat(season);", // .concat
      'const topic = `round:%s`.replace("%s", id);', // template + .replace
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
          'const topic = buildRoundPresenceTopic(roundId);',
        ),
        handBuiltTopicPattern.test(
          "requirePermission(principal, 'round:create');",
        ),
      ],
      expected: [false, false],
    });
  });
});
