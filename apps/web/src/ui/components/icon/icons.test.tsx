import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { iconPaths } from './icons';
import { tiles } from '../../dashboard/tiles';

setupRitewayBun();

// IconName is an open string key, so a typo renders an empty <svg> silently.
// The expected names are derived from the consumers instead of a hand-kept
// list: every literal icon reference in non-test source under src/.
const sourceDirectory = join(import.meta.dir, '../../..');

const iconReferences = [
  /<Icon(?:Button)?\b[^>]*?\bname="([^"]+)"/g,
  /\bicon="([^"]+)"/g,
  /\b(?:icon|glyph): '([^']+)'/g,
];

const sourceFiles = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });

const referencedIcons = (): readonly string[] => {
  const names = sourceFiles(sourceDirectory).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return iconReferences.flatMap((pattern) =>
      [...source.matchAll(pattern)].map((match) => match[1] ?? ''),
    );
  });
  return [...new Set(names)].sort();
};

const isDrawn = (name: string): boolean =>
  renderToString(h('svg', null, iconPaths[name])) !== '<svg></svg>';

describe('icon set', () => {
  test('finds the icon references in consumer source', () => {
    const names = referencedIcons();
    assert({
      given: 'a scan of non-test source for literal icon references',
      should:
        'see JSX literals, panel/stat icon props, and nav/tile data alike',
      actual: [
        'calendar',
        'chevronRight',
        'bell',
        'message',
        'home',
        ...tiles.map((tile) => tile.glyph),
      ].filter((name) => !names.includes(name)),
      expected: [],
    });
  });

  test('draws every icon that source references', () => {
    assert({
      given: 'every icon name referenced anywhere in the app source',
      should: 'have drawable shapes (no silently empty icons)',
      actual: referencedIcons().filter((name) => !isDrawn(name)),
      expected: [],
    });
  });
});
