import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { tiles } from './tiles';

setupRitewayBun();

const appDirectory = join(import.meta.dir, '../../app');

const undefinedClasses = (
  cssPath: string,
  names: readonly string[],
): readonly string[] => {
  const css = readFileSync(join(import.meta.dir, cssPath), 'utf8');
  return [...new Set(names)].filter(
    (name) => !new RegExp(`\\.${name}[\\s.{]`).test(css),
  );
};

describe('tile destinations', () => {
  test('point at routes that exist', () => {
    assert({
      given: 'the tile configuration',
      should: 'have an app router page for every destination',
      actual: tiles
        .map((tile) => tile.href)
        .filter((href) => !existsSync(join(appDirectory, href, 'page.tsx'))),
      expected: [],
    });
  });

  test('use only tints and tones the stylesheets define', () => {
    assert({
      given: 'every tint and status tone in use, including the neutral default',
      should: 'resolve to a defined CSS module class, never "undefined"',
      actual: [
        undefinedClasses(
          'action-tile/action-tile.module.css',
          tiles.map((tile) => tile.tint ?? 'neutral'),
        ),
        undefinedClasses(
          '../components/status-line/status-line.module.css',
          tiles.map((tile) => tile.status?.tone ?? 'neutral'),
        ),
      ],
      expected: [[], []],
    });
  });
});
