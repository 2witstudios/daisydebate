import { join } from 'node:path';
import { mock } from 'bun:test';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { participantPathOf } from './routes';
import type { SampleScene } from './sample/scene';

setupRitewayBun();

const app = join(import.meta.dir, '../../app');

// Each host page runs with this viewer in place of the request's cookie. The
// test calls the page itself, so a page that drops its guard, or names
// another page's address in it, fails here.
let viewer: SampleScene = { viewer: 'competitor', moment: 'elims' };
mock.module(join(import.meta.dir, 'sample/request-scene.ts'), () => ({
  requestSampleScene: async () => viewer,
}));

const sample: Readonly<Record<string, string>> = {
  slug: 'autumn-open',
  event: 'varsity-debate',
  round: '3',
  slot: '1200',
};

/** `(host)/host/tournaments/[slug]/setup/page.tsx` → its address for the sample. */
const addressOf = (file: string): string =>
  `/${file
    .replace(/\/?page\.tsx$/, '')
    .split('/')
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .map((segment) => sample[segment.replace(/^\[(.*)\]$/, '$1')] ?? segment)
    .join('/')}`;

type Page = (props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string>>;
}) => Promise<unknown>;

// Literal specifiers, so the import boundaries can check them. The first test
// fails when a page under (host) is missing from this list.
const loaders: Readonly<Record<string, () => Promise<unknown>>> = {
  '(host)/host/leagues/[slug]/page.tsx': () =>
    import('../../app/(host)/host/leagues/[slug]/page'),
  '(host)/host/leagues/[slug]/people/page.tsx': () =>
    import('../../app/(host)/host/leagues/[slug]/people/page'),
  '(host)/host/page.tsx': () => import('../../app/(host)/host/page'),
  '(host)/host/tournaments/[slug]/entries/page.tsx': () =>
    import('../../app/(host)/host/tournaments/[slug]/entries/page'),
  '(host)/host/tournaments/[slug]/events/[event]/ballot/page.tsx': () =>
    import('../../app/(host)/host/tournaments/[slug]/events/[event]/ballot/page'),
  '(host)/host/tournaments/[slug]/events/[event]/resolutions/page.tsx': () =>
    import('../../app/(host)/host/tournaments/[slug]/events/[event]/resolutions/page'),
  '(host)/host/tournaments/[slug]/events/[event]/rounds/[round]/page.tsx': () =>
    import('../../app/(host)/host/tournaments/[slug]/events/[event]/rounds/[round]/page'),
  '(host)/host/tournaments/[slug]/events/page.tsx': () =>
    import('../../app/(host)/host/tournaments/[slug]/events/page'),
  '(host)/host/tournaments/[slug]/judges/page.tsx': () =>
    import('../../app/(host)/host/tournaments/[slug]/judges/page'),
  '(host)/host/tournaments/[slug]/page.tsx': () =>
    import('../../app/(host)/host/tournaments/[slug]/page'),
  '(host)/host/tournaments/[slug]/people/page.tsx': () =>
    import('../../app/(host)/host/tournaments/[slug]/people/page'),
  '(host)/host/tournaments/[slug]/results/page.tsx': () =>
    import('../../app/(host)/host/tournaments/[slug]/results/page'),
  '(host)/host/tournaments/[slug]/setup/page.tsx': () =>
    import('../../app/(host)/host/tournaments/[slug]/setup/page'),
  '(host)/host/tournaments/[slug]/slots/[slot]/page.tsx': () =>
    import('../../app/(host)/host/tournaments/[slug]/slots/[slot]/page'),
  '(host)/host/tournaments/[slug]/standings/page.tsx': () =>
    import('../../app/(host)/host/tournaments/[slug]/standings/page'),
};

/** Where the page sent its viewer, or null when it answered some other way. */
async function redirectOf(file: string): Promise<string | null> {
  try {
    const page = (await loaders[file]?.()) as { default: Page };
    await page.default({
      params: Promise.resolve(sample),
      searchParams: Promise.resolve({}),
    });
    return null;
  } catch (error) {
    // Next's redirect throws an error whose digest carries the destination.
    const digest =
      typeof error === 'object' && error !== null && 'digest' in error
        ? String(error.digest)
        : '';
    const [kind, , destination] = digest.split(';');
    return kind === 'NEXT_REDIRECT' && destination !== undefined
      ? destination
      : null;
  }
}

const hostPages = [...new Glob('(host)/**/page.tsx').scanSync(app)].sort();

describe('the host area', () => {
  test('every host page turns away a viewer without a grant', async () => {
    viewer = { viewer: 'competitor', moment: 'elims' };
    const sent: Array<readonly [string, string | null]> = [];
    for (const file of hostPages)
      sent.push([addressOf(file), await redirectOf(file)]);
    assert({
      given: 'each page under /host, opened by a competitor',
      should: 'send them to the participant page for that page’s own address',
      actual: [hostPages.length >= 15, sent],
      expected: [
        true,
        hostPages.map((file) => [
          addressOf(file),
          participantPathOf(addressOf(file)),
        ]),
      ],
    });
  });

  test('a viewer with a grant stays in the host area', async () => {
    viewer = { viewer: 'host', moment: 'elims' };
    const sent: Array<string | null> = [];
    for (const file of hostPages) sent.push(await redirectOf(file));
    assert({
      given: 'each page under /host, opened by the host',
      should:
        'answer with its screen, or move on to another host page, never the participant side',
      actual: sent.filter(
        (destination) =>
          destination !== null && !destination.startsWith('/host/'),
      ),
      expected: [],
    });
  });
});
