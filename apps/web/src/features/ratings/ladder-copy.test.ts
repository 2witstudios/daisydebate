import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

/**
 * Owner copy rule (ADR 0156): copy names no ladder, style-in-a-division or
 * pair of divisions, so it never changes as styles are added; only the lobby
 * switch says Open or Youth. A league request still chooses which divisions a
 * league runs, so its option names them.
 */
const ladderNames =
  /Open – |Youth – |Freestyle ladder|Youth and Open|Open and Youth/;
const allowed = new Set(['features/league-requests/labels.ts']);
const root = join(import.meta.dir, '../../..');

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test(-support)?\.tsx?$/.test(name)
      ? [path]
      : [];
  });

/** A source line that is copy, not a comment. */
const copyLines = (text: string) =>
  text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));

test('no copy names a ladder (ADR 0156 copy rule)', () => {
  const offenders = sources(join(root, 'src')).flatMap((path) => {
    const name = relative(join(root, 'src'), path);
    if (allowed.has(name)) return [];
    return copyLines(readFileSync(path, 'utf8'))
      .filter((line) => ladderNames.test(line))
      .map((line) => `${name}: ${line.trim()}`);
  });
  assert({
    given: 'every web source file',
    should: 'carry no ladder or division-pair names in its copy',
    actual: offenders,
    expected: [],
  });
});
