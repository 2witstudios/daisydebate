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
        'offer one current Daisy-authored Policy and Value resolution with pinned provenance',
      actual: resolutions.map(({ kind, text, provenance }) => ({
        kind,
        text,
        provenance,
      })),
      expected: [
        {
          kind: 'policy',
          text: 'The United States federal government should substantially increase its investment in high-speed rail.',
          provenance:
            'Daisy-original resolution bank revision 1: pryied8jvkvrn7g0p60iv632',
        },
        {
          kind: 'value',
          text: 'Privacy ought to be valued above public safety.',
          provenance:
            'Daisy-original resolution bank revision 1: b6b9yjq40xv9kmbvy4kwxahn',
        },
      ],
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
