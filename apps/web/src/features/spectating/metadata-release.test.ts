import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const appRoot = join(import.meta.dir, '../../app');

describe('page metadata', () => {
  test('no Round page builds metadata from a Round', () => {
    const dynamic = (
      readdirSync(appRoot, { recursive: true }) as string[]
    ).filter(
      (file) =>
        /page\.tsx$|layout\.tsx$/.test(file) &&
        readFileSync(join(appRoot, file), 'utf8').includes('generateMetadata'),
    );
    assert({
      given: 'every page and layout',
      should:
        'build metadata only where no Round is read, so a title or social card cannot state an outcome before release',
      actual: dynamic.sort(),
      // The guide pages read no Round: their metadata is an article's or a
      // collection's title, or nothing where its release is closed.
      expected: [
        '(shell)/guides/[collection]/[slug]/page.tsx',
        '(shell)/guides/[collection]/page.tsx',
        '(shell)/learn/[collection]/[slug]/page.tsx',
        '(shell)/learn/[collection]/page.tsx',
        '(shell)/stories/[slug]/page.tsx',
        'layout.tsx',
      ],
    });
  });
});
