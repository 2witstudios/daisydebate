import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { casualTemplates } from '../src/catalog-casual';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('the catalog holds the four casual templates exactly as catalog-casual.ts spells them, none ranked-eligible (TAB-6.18)', async () => {
  const sql = new SQL(url, { max: 1 });
  try {
    const added = await sql`
      select f.id, f.catalog_role, f.family, f.leagues, r.definition,
             p.config, p.ranked_eligible
        from formats f
        join format_revisions r on r.format_id = f.id and r.version = 1
        join format_presets p on p.format_id = f.id and p.version = 1
       where f.id in ${sql(casualTemplates.map((t) => t.id))}
       order by f.sort_order`;
    assert({
      given: 'the committed migrations applied to the test database',
      should:
        'hold each casual template as a template of no league, with its definition and preset, not ranked-eligible',
      actual: [...added],
      expected: casualTemplates.map((template) => ({
        id: template.id,
        catalog_role: 'template',
        family: 'other',
        leagues: [],
        definition: template.definition,
        config: template.preset,
        ranked_eligible: false,
      })),
    });
  } finally {
    await sql.close();
  }
});
