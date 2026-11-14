import { afterAll } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { casualTemplates } from '../src/catalog-casual';
import { withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const migration = '20261114172122_tab_casual_templates';
const scratch = scratchDatabase(url, 'casualtpl');

afterAll(() => scratch.drop());

test(
  'the casual templates join a catalog that already holds formats, presets and a member’s own format, leaving each untouched (TAB-6.18)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (f) => {
      const owned = await f.format();
      const catalogBefore = await f.sql`
        select f.id, f.current_version, r.definition, p.config, p.ranked_eligible
          from formats f
          join format_revisions r on r.format_id = f.id and r.version = f.current_version
          left join format_presets p on p.format_id = f.id and p.superseded_at is null
         order by f.id, p.version`;
      await scratch.migrate((folder) => folder <= migration);
      const catalogAfter = await f.sql`
        select f.id, f.current_version, r.definition, p.config, p.ranked_eligible
          from formats f
          join format_revisions r on r.format_id = f.id and r.version = f.current_version
          left join format_presets p on p.format_id = f.id and p.superseded_at is null
         where f.id not in ${f.sql(casualTemplates.map((t) => t.id))}
         order by f.id, p.version`;
      const added = await f.sql`
        select f.id, f.catalog_role, f.family, f.leagues, r.definition,
               p.config, p.ranked_eligible
          from formats f
          join format_revisions r on r.format_id = f.id and r.version = 1
          join format_presets p on p.format_id = f.id and p.version = 1
         where f.id in ${f.sql(casualTemplates.map((t) => t.id))}
         order by f.sort_order`;
      assert({
        given:
          'a database migrated to the migration before it, holding the catalog and a member’s own format',
        should:
          'add the four casual templates exactly as catalog-casual.ts spells them, none ranked-eligible, and change no row already there',
        actual: {
          kept: [...catalogAfter],
          owned: catalogAfter.some((row: { id: string }) => row.id === owned),
          added: [...added],
        },
        expected: {
          kept: [...catalogBefore],
          owned: true,
          added: casualTemplates.map((template) => ({
            id: template.id,
            catalog_role: 'template',
            family: 'other',
            leagues: [],
            definition: template.definition,
            config: template.preset,
            ranked_eligible: false,
          })),
        },
      });
    });
  },
  ddlTimeoutMs * 3,
);
