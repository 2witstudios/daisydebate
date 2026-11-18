import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { flagCatalogue } from '../flags/catalogue';

setupRitewayBun();

const app = join(import.meta.dir, '../../app');
const groups = ['(tab)', '(tab-live)', '(host)', '(host-preview)'];

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
    const sceneRead = readFileSync(
      join(import.meta.dir, 'sample/request-scene.ts'),
      'utf8',
    );
    const pages = groups.flatMap((group) =>
      [...new Glob(`${group}/**/page.tsx`).scanSync(app)].filter(
        (page) =>
          !/requestSampleScene\(|requestLeaguePage\(|requestStandingRoomPage\(|requireGrant\(|await requireTabRelease\(\)|await requireHostTiersRelease\(\)|StoredDrawOverview|StoredHostEvents|StoredRoster|StoredHostRound/.test(
            readFileSync(join(app, page), 'utf8'),
          ),
      ),
    );
    assert({
      given:
        'a layout that is not run again when someone moves between its pages',
      should:
        'have every page recheck the release directly or through its scene, whose reader refuses first while closed',
      actual: [
        /Promise<SampleScene> \{\n\s+await requireTabRelease\(\);/.test(
          sceneRead,
        ),
        pages,
      ],
      expected: [true, []],
    });
  });

  test('stored league request readers refuse a closed release before database reads', () => {
    const source = readFileSync(join(app, '../lib/request-session.ts'), 'utf8');
    assert({
      given: 'the stored league and standing Room request readers',
      should: 'check the member release before acquiring their database store',
      actual: ['requestLeaguePage', 'requestStandingRoomPage'].map((name) => {
        const reader = source.slice(source.indexOf(`export const ${name} =`));
        const release = reader.indexOf("requestReleaseEnabled('daisy-tab'");
        const database = reader.indexOf('processApp()');
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
    assert({
      given: 'the tournaments page source',
      should: 'return the information page before reading anything of Tab',
      actual: readFileSync(
        join(app, '(shell)/tournaments/page.tsx'),
        'utf8',
      ).includes('return <TournamentsInfo />;'),
      expected: true,
    });
  });
});
