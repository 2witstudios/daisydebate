import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { flagCatalogue } from '../flags/catalogue';

setupRitewayBun();

const app = join(import.meta.dir, '../../app');
const groups = ['(tab)', '(tab-live)', '(host)'];

describe('the Tab release', () => {
  test('closed by default', () => {
    assert({
      given: 'the flag catalogue',
      should: 'hold Tab as a release that is off until someone opens it',
      actual: flagCatalogue
        .filter((entry) => entry.key === 'daisy-tab')
        .map((entry) => [entry.kind, entry.safeDefault]),
      expected: [['release', false]],
    });
  });

  test('every Tab page stands behind the gate', () => {
    const pages = [...new Glob('**/page.tsx').scanSync(app)].filter((page) =>
      readFileSync(join(app, page), 'utf8').includes('features/tab/'),
    );
    const gated = groups.filter((group) =>
      /await requireTabRelease\(\);\n\s+return/.test(
        readFileSync(join(app, group, 'layout.tsx'), 'utf8'),
      ),
    );
    assert({
      given: 'every page that reads a Tab feature module',
      should:
        'sit in a group whose layout refuses before it renders, or be the tournaments page that keeps its old answer',
      actual: [
        gated,
        pages.filter(
          (page) => !groups.some((group) => page.startsWith(`${group}/`)),
        ),
        pages.length > 20,
      ],
      expected: [groups, [], true],
    });
  });

  test('every Tab page rechecks the release itself', () => {
    const pages = groups.flatMap((group) =>
      [...new Glob(`${group}/**/page.tsx`).scanSync(app)].filter(
        (page) =>
          !/requestLeaguePage\(|requestStandingRoomPage\(|requireGrant\(|await requireTabRelease\(\)|await requireHostTiersRelease\(\)|StoredDrawOverview|StoredHostEvents|StoredRoster|StoredHostRound|storedTournament(Posting)?\(|storedDirectory\(|TournamentResults|storedEventRoom\(/.test(
            readFileSync(join(app, page), 'utf8'),
          ),
      ),
    );
    assert({
      given:
        'a layout that is not run again when someone moves between its pages',
      should:
        'have every page recheck the release directly or through its reader, which refuses first while closed',
      actual: pages,
      expected: [],
    });
  });

  test('stored league request readers refuse a closed release before database reads', () => {
    const source = readFileSync(
      join(app, '../features/tab/page-reads.ts'),
      'utf8',
    );
    assert({
      given: 'the stored league and standing Room request readers',
      should: 'check the member release before acquiring their database store',
      actual: ['requestLeaguePage', 'requestStandingRoomPage'].map((name) => {
        const reader = source.slice(source.indexOf(`export const ${name} =`));
        const release = reader.indexOf("requestReleaseEnabled('daisy-tab'");
        const database = reader.indexOf('requestApp()');
        return (
          release >= 0 &&
          release < database &&
          reader.slice(release, database).includes('return null;')
        );
      }),
      expected: [true, true],
    });
  });

  test('the tournaments page keeps its answer while the release is closed', () => {
    const page = readFileSync(
      join(app, '(shell)/tournaments/page.tsx'),
      'utf8',
    );
    const outsideReaders = [...new Glob('**/page.tsx').scanSync(app)].filter(
      (path) =>
        !groups.some((group) => path.startsWith(`${group}/`)) &&
        readFileSync(join(app, path), 'utf8').includes('tab-release'),
    );
    assert({
      given: 'the tournaments page source',
      should:
        'render the information page, reading only Tab’s published release check',
      actual: [
        page.includes('<TournamentsInfo tabReleased={await tabReleased()} />'),
        page.includes('features/tab/'),
      ],
      expected: [true, false],
    });
    assert({
      given: 'every page outside Tab’s groups that reads the release',
      should:
        'be the tournaments page or an onboarding intro step, reading only the release',
      actual: outsideReaders.sort(),
      expected: [
        '(bare)/onboarding/daisy/page.tsx',
        '(bare)/onboarding/host/page.tsx',
        '(shell)/tournaments/page.tsx',
      ],
    });
  });
});
