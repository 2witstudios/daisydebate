import { join, relative } from 'node:path';
import { readFileSync } from 'node:fs';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roundMediaPages } from '../../features/round-media/browser-policy';
import { clientEntriesToMedia } from './media-href-scan.test-support';

setupRitewayBun();

const srcDirectory = join(import.meta.dir, '../..');
const sources = [...new Glob('**/*.{ts,tsx}').scanSync(srcDirectory)]
  .filter((file) => !/\.test\.tsx?$/.test(file) && !file.includes('test-'))
  .map((file) => ({
    file: relative(srcDirectory, join(srcDirectory, file)),
    text: readFileSync(join(srcDirectory, file), 'utf8'),
  }));

describe('entering a round media page', () => {
  test('no client-side navigation targets a media page', () => {
    const offenders = clientEntriesToMedia(sources);
    assert({
      given:
        'every next/link and router push or replace in the app source, literal or computed by a media href builder',
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
