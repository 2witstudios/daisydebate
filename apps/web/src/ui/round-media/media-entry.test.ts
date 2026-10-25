import { join, relative } from 'node:path';
import { readFileSync } from 'node:fs';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  isRoundMediaHref,
  roundMediaPages,
} from '../../features/round-media/browser-policy';

setupRitewayBun();

const srcDirectory = join(import.meta.dir, '../..');
const sources = [...new Glob('**/*.{ts,tsx}').scanSync(srcDirectory)]
  .filter((file) => !/\.test\.tsx?$/.test(file) && !file.includes('test-'))
  .map((file) => ({
    file: relative(srcDirectory, join(srcDirectory, file)),
    text: readFileSync(join(srcDirectory, file), 'utf8'),
  }));

// A template literal's `${…}` stands for one path segment.
const samplePath = (literal: string) => literal.replace(/\$\{[^}]*\}/g, 'x');
const hrefAttribute = /href=\{?\s*([`'"])(\/[^`'"]*)\1/g;
const routerCall = /router\.(?:push|replace)\(\s*([`'"])(\/[^`'"]*)\1/g;

/** The element a JSX attribute at `index` belongs to. */
const elementAt = (text: string, index: number) =>
  [...text.slice(0, index).matchAll(/<([A-Za-z][\w.]*)/g)].at(-1)?.[1];

describe('entering a round media page', () => {
  test('no client-side navigation targets a media page', () => {
    const offenders = sources.flatMap(({ file, text }) => [
      ...[...text.matchAll(hrefAttribute)]
        .filter((match) => elementAt(text, match.index) === 'Link')
        .filter((match) => isRoundMediaHref(samplePath(match[2]!)))
        .map((match) => `${file}: <Link href=${match[2]}>`),
      ...[...text.matchAll(routerCall)]
        .filter((match) => isRoundMediaHref(samplePath(match[2]!)))
        .map((match) => `${file}: ${match[0]}`),
    ]);
    assert({
      given: 'every next/link and router push or replace in the app source',
      should:
        'enter a media page by MediaPageLink or replaceRoute, so its own Permissions-Policy applies',
      actual: offenders,
      expected: [],
    });
  });

  test('every media page renders the document guard', () => {
    const pageFile = (source: string) =>
      sources.find(
        ({ file }) =>
          file.replace(/\([^)]+\)\//g, '').replace(/\[id\]/g, ':id') ===
          `app${source}/page.tsx`,
      );
    assert({
      given: 'each route that receives the media Permissions-Policy',
      should: 'render MediaDocument, which reloads a stale document',
      actual: roundMediaPages.map((source) => ({
        source,
        guarded: pageFile(source)?.text.includes('<MediaDocument') ?? false,
      })),
      expected: roundMediaPages.map((source) => ({ source, guarded: true })),
    });
  });
});
