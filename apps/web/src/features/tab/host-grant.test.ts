import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const app = join(import.meta.dir, '../../app');

const hostPages = [...new Glob('(host)/**/page.tsx').scanSync(app)].sort();
// Stored pages consume evaluated HTTP reads, and this source read supplies
// no member session. Real narrow-role/refusal/revocation checks
// live in tab-host-areas.integration.ts. Keep their page bindings exhaustive.
const storedPages = hostPages.filter((file) => {
  const source = readFileSync(join(app, file), 'utf8');
  return (
    source.includes('readStoredHostNavigation(') &&
    /(?:readOwnRoute|readStoredHostEvents)\(/.test(source) &&
    !source.includes('requireGrant(')
  );
});
const storedLeaguePages = hostPages.filter((file) =>
  readFileSync(join(app, file), 'utf8').includes('await requestLeaguePage('),
);
describe('the host area', () => {
  test('stored league pages require an evaluated host read', () => {
    assert({
      given: 'the league host page',
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
      given: 'stored host pages',
      should:
        'refuse before rendering without navigation or their actual area read, with no missing inventory entry',
      actual: storedPages.map((file) => {
        const source = readFileSync(join(app, file), 'utf8'),
          // Host tiers' pages gate on Tab and host tiers together (ADR 0149).
          release = Math.max(
            source.indexOf('await requireTabRelease()'),
            source.indexOf('await requireHostTiersRelease()'),
          ),
          navigation = source.indexOf('await readStoredHostNavigation('),
          read = source.search(
            /(?:await (?:readOwnRoute|readStoredHostEvents)|=>\s*readOwnRoute)\(/,
          );
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
          '(host)/host/tournaments/[slug]/billing/page.tsx',
          true,
          true,
          true,
          true,
        ],
        [
          '(host)/host/tournaments/[slug]/events/[event]/resolutions/page.tsx',
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
          '(host)/host/tournaments/[slug]/slots/[slot]/page.tsx',
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
        [
          '(host)/host/tournaments/[slug]/upgrade/page.tsx',
          true,
          true,
          true,
          true,
        ],
      ],
    });
  });
});
