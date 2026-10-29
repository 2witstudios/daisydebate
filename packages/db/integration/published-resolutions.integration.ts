import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { readPublishedResolutions } from '../src/published-resolutions';
import { withFixture, sqlStateOf } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('published Policy and Value resolutions are authoritative immutable records', async () => {
  await withFixture(url, async (fixture) => {
    const resolutions = await readPublishedResolutions(
      drizzle({ client: fixture.sql }),
    );
    assert({
      given: 'the migrated publication catalog',
      should:
        'offer the exact owner-confirmed Beta Season 1 wording, themes and provenance',
      actual: resolutions.map(({ kind, text, provenance, edition, theme }) => ({
        kind,
        text,
        provenance,
        edition,
        theme,
      })),
      expected: [
        {
          kind: 'policy',
          text: 'Resolved: Competitive debate should be a mandatory component of the core curriculum in American public education.',
          provenance: 'Owner-confirmed Daisy Beta Season 1 (2026-10-29)',
          edition: 'Beta Season 1',
          theme: 'Education and institutional adoption',
        },
        {
          kind: 'value',
          text: 'Resolved: The world would be a better place if traditional sports were replaced by competitive debate.',
          provenance: 'Owner-confirmed Daisy Beta Season 1 (2026-10-29)',
          edition: 'Beta Season 1',
          theme: 'Culture and social priorities',
        },
      ],
    });
    const old =
      await fixture.sql`select id,text,retired_at from published_resolutions where id in ('g0c8gv3cg20oee0g5pvifxeu','se5d9pwcwp7cbvb0fi7mku4a') order by kind`;
    assert({
      given: 'the forward Season 1 publication migration',
      should: 'retire prior records without rewriting their wording',
      actual: old.map((row) => [row.text, row.retired_at !== null]),
      expected: [
        [
          'The United States federal government should substantially increase its investment in high-speed rail.',
          true,
        ],
        ['Privacy ought to be valued above public safety.', true],
      ],
    });
    assert({
      given: 'an immutable publication’s descriptive season association',
      should: 'refuse changing its theme after publication',
      actual: await sqlStateOf(
        () =>
          fixture.sql`update published_resolutions set theme='Changed theme' where id=${resolutions[0]!.id}`,
      ),
      expected: '23514',
    });
    assert({
      given:
        'a published resolution whose wording is already referenced by rooms',
      should: 'refuse rewriting the text',
      actual: await sqlStateOf(() =>
        fixture.sql.unsafe(
          'update published_resolutions set text = $1 where id = $2',
          ['Changed after publication', resolutions[0]!.id],
        ),
      ),
      expected: '23514',
    });
  });
});
