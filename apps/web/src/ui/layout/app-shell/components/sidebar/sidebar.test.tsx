import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Sidebar } from './sidebar';

setupRitewayBun();

const appDirectory = join(import.meta.dir, '../../../../../app');

/** Resolves a URL path against the app router tree, allowing [param] dirs. */
const routeExists = (href: string): boolean => {
  const directory = href
    .split('/')
    .filter(Boolean)
    .reduce<string | undefined>((current, segment) => {
      if (current === undefined) return undefined;
      if (existsSync(join(current, segment))) return join(current, segment);
      const dynamic = readdirSync(current).find((name) => name.startsWith('['));
      return dynamic ? join(current, dynamic) : undefined;
    }, appDirectory);
  return directory !== undefined && existsSync(join(directory, 'page.tsx'));
};

describe('Sidebar', () => {
  test('is the primary navigation landmark', () => {
    const html = renderToString(h(Sidebar));
    assert({
      given: 'the sidebar',
      should: 'render exactly one nav, named "Primary"',
      actual: [
        /^<nav[^>]* aria-label="Primary"/.test(html),
        html.split('<nav').length - 1,
      ],
      expected: [true, 1],
    });
  });

  test('links only to routes that exist', () => {
    const html = renderToString(h(Sidebar));
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    );
    assert({
      given: 'every link in the sidebar, flyouts included',
      should: 'cover the core destinations and resolve to an app router page',
      actual: [
        ['/', '/lobby', '/recordings', '/settings'].filter(
          (href) => !hrefs.includes(href),
        ),
        hrefs.filter((href) => !routeExists(href)),
      ],
      expected: [[], []],
    });
  });
});
