import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mock } from 'bun:test';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { walkHref } from './walk-href';
import { participantPathOf } from './routes';
import { LEAGUE } from './sample/moment';
import type { SampleScene } from './sample/scene';

setupRitewayBun();

const app = join(import.meta.dir, '../../app');

// Each host page runs with this viewer in place of the request's cookie. The
// test calls the page itself, so a page that drops its guard, or names
// another page's address in it, fails here.
let viewer: SampleScene = {
  viewer: 'competitor',
  moment: 'elims',
  scale: 'normal',
};
mock.module(join(import.meta.dir, 'sample/request-scene.ts'), () => ({
  requestSampleScene: async () => viewer,
}));

const sample: Readonly<Record<string, string>> = {
  slug: 'autumn-open',
  event: 'varsity-debate',
  round: '3',
  slot: '1200',
};

/**
 * `(host)/host/tournaments/[slug]/setup/page.tsx` → its address for the
 * sample. A league page is the sample league's: any other league address is
 * a stored organization, which answers a viewer it denies as not found.
 */
const sampleFor = (file: string): Readonly<Record<string, string>> =>
  file.includes('/leagues/') ? { ...sample, slug: LEAGUE } : sample;
const addressOf = (file: string): string => {
  const values = sampleFor(file);
  return `/${file
    .replace('(host-preview)/tournaments/walk/', '')
    .replace(/\/?page\.tsx$/, '')
    .split('/')
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .map((segment) => values[segment.replace(/^\[(.*)\]$/, '$1')] ?? segment)
    .join('/')}`;
};

type Page = (props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string>>;
}) => Promise<unknown>;

// Literal specifiers, so the import boundaries can check them. The first test
// fails when a page under (host) is missing from this list.
const loaders: Readonly<Record<string, () => Promise<unknown>>> = {
  '(host-preview)/tournaments/walk/host/leagues/[slug]/page.tsx': () =>
    import('../../app/(host-preview)/tournaments/walk/host/leagues/[slug]/page'),
  '(host-preview)/tournaments/walk/host/leagues/[slug]/people/page.tsx': () =>
    import('../../app/(host-preview)/tournaments/walk/host/leagues/[slug]/people/page'),
  '(host-preview)/tournaments/walk/host/page.tsx': () =>
    import('../../app/(host-preview)/tournaments/walk/host/page'),
  '(host-preview)/tournaments/walk/host/tournaments/[slug]/entries/page.tsx':
    () =>
      import('../../app/(host-preview)/tournaments/walk/host/tournaments/[slug]/entries/page'),
  '(host-preview)/tournaments/walk/host/tournaments/[slug]/events/[event]/ballot/page.tsx':
    () =>
      import('../../app/(host-preview)/tournaments/walk/host/tournaments/[slug]/events/[event]/ballot/page'),
  '(host-preview)/tournaments/walk/host/tournaments/[slug]/events/[event]/resolutions/page.tsx':
    () =>
      import('../../app/(host-preview)/tournaments/walk/host/tournaments/[slug]/events/[event]/resolutions/page'),
  '(host-preview)/tournaments/walk/host/tournaments/[slug]/events/[event]/rounds/[round]/page.tsx':
    () =>
      import('../../app/(host-preview)/tournaments/walk/host/tournaments/[slug]/events/[event]/rounds/[round]/page'),
  '(host-preview)/tournaments/walk/host/tournaments/[slug]/events/page.tsx':
    () =>
      import('../../app/(host-preview)/tournaments/walk/host/tournaments/[slug]/events/page'),
  '(host-preview)/tournaments/walk/host/tournaments/[slug]/judges/page.tsx':
    () =>
      import('../../app/(host-preview)/tournaments/walk/host/tournaments/[slug]/judges/page'),
  '(host-preview)/tournaments/walk/host/tournaments/[slug]/page.tsx': () =>
    import('../../app/(host-preview)/tournaments/walk/host/tournaments/[slug]/page'),
  '(host-preview)/tournaments/walk/host/tournaments/[slug]/people/page.tsx':
    () =>
      import('../../app/(host-preview)/tournaments/walk/host/tournaments/[slug]/people/page'),
  '(host-preview)/tournaments/walk/host/tournaments/[slug]/results/page.tsx':
    () =>
      import('../../app/(host-preview)/tournaments/walk/host/tournaments/[slug]/results/page'),
  '(host-preview)/tournaments/walk/host/tournaments/[slug]/setup/page.tsx':
    () =>
      import('../../app/(host-preview)/tournaments/walk/host/tournaments/[slug]/setup/page'),
  '(host-preview)/tournaments/walk/host/tournaments/[slug]/slots/[slot]/page.tsx':
    () =>
      import('../../app/(host-preview)/tournaments/walk/host/tournaments/[slug]/slots/[slot]/page'),
  '(host-preview)/tournaments/walk/host/tournaments/[slug]/standings/page.tsx':
    () =>
      import('../../app/(host-preview)/tournaments/walk/host/tournaments/[slug]/standings/page'),
};

/** Where the page sent its viewer, or null when it answered some other way. */
async function redirectOf(file: string): Promise<string | null> {
  try {
    const page = (await loaders[file]?.()) as { default: Page };
    await page.default({
      params: Promise.resolve(sampleFor(file)),
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
// Stored pages consume evaluated HTTP reads; this cookie-based sample frame
// supplies no real member session. Real narrow-role/refusal/revocation checks
// live in tab-host-areas.integration.ts. Keep their page bindings exhaustive.
const storedPages = hostPages.filter((file) => {
  const source = readFileSync(join(app, file), 'utf8');
  return (
    source.includes('readStoredHostNavigation(') &&
    source.includes('readOwnRoute(') &&
    !source.includes('requireGrant(')
  );
});
const storedLeaguePages = hostPages.filter((file) =>
  readFileSync(join(app, file), 'utf8').includes('await requestLeaguePage('),
);
const samplePages = [
  ...new Glob('(host-preview)/tournaments/walk/host/**/page.tsx').scanSync(app),
].sort();

describe('the host area', () => {
  test('stored league pages require an evaluated host read', () => {
    assert({
      given: 'the league host page outside the sample-cookie frame',
      should:
        'refuse absent reads and require actual host authority before rendering',
      actual: storedLeaguePages.map((file) => {
        const source = readFileSync(join(app, file), 'utf8');
        const read = source.indexOf('await requestLeaguePage(');
        const render = source.indexOf('<HostLeague');
        const guarded = source.slice(read, render);
        return [
          file,
          guarded.includes('if (!read) notFound();'),
          guarded.includes('if (!read.season.canHost)') &&
            guarded.includes('notFound();'),
        ];
      }),
      expected: [['(host)/host/leagues/[slug]/page.tsx', true, true]],
    });
  });
  test('stored host pages keep their own release and evaluated area read boundaries', () => {
    assert({
      given: 'stored host pages outside the sample-cookie frame',
      should:
        'refuse before rendering without navigation or their actual area read, with no missing inventory entry',
      actual: storedPages.map((file) => {
        const source = readFileSync(join(app, file), 'utf8'),
          release = source.indexOf('await requireTabRelease()'),
          navigation = source.indexOf('await readStoredHostNavigation('),
          read = source.indexOf('await readOwnRoute(');
        return [
          file,
          release >= 0 && release < navigation && navigation < read,
          source
            .slice(navigation, read)
            .includes('if (!navigation) notFound();'),
          source.slice(read).includes('notFound();'),
          !source.includes('/sample/'),
        ];
      }),
      expected: [
        [
          '(host)/host/tournaments/[slug]/ballots/page.tsx',
          true,
          true,
          true,
          true,
        ],
        [
          '(host)/host/tournaments/[slug]/people/page.tsx',
          true,
          true,
          true,
          true,
        ],
        [
          '(host)/host/tournaments/[slug]/results/page.tsx',
          true,
          true,
          true,
          true,
        ],
        [
          '(host)/host/tournaments/[slug]/standings/page.tsx',
          true,
          true,
          true,
          true,
        ],
      ],
    });
  });

  test('every sample host page redirects a viewer without a grant', async () => {
    viewer = { viewer: 'competitor', moment: 'elims', scale: 'normal' };
    const sent: Array<readonly [string, string | null]> = [];
    for (const file of samplePages)
      sent.push([addressOf(file), await redirectOf(file)]);
    assert({
      given: 'each sample page under /host, opened by a competitor',
      should: 'send them to the participant page for that page’s own address',
      actual: [samplePages.length >= 15, sent],
      expected: [
        true,
        samplePages.map((file) => [
          addressOf(file),
          walkHref(participantPathOf(addressOf(file))),
        ]),
      ],
    });
  });

  test('a viewer with a grant stays in the host area', async () => {
    viewer = { viewer: 'host', moment: 'elims', scale: 'normal' };
    const sent: Array<string | null> = [];
    for (const file of samplePages) sent.push(await redirectOf(file));
    assert({
      given: 'each page under /host, opened by the host',
      should:
        'answer with its screen, or move on to another host page, never the participant side',
      actual: sent.filter(
        (destination) =>
          destination !== null &&
          !destination.startsWith('/tournaments/walk/host/'),
      ),
      expected: [],
    });
  });
});
