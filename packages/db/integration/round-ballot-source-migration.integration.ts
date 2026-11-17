import { SQL } from 'bun';
import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { daisyWinnerBallot, panelRuleFor } from '@daisy/protocol';
import { assert, test } from 'riteway/bun';
import { Fixture } from './constraint-helpers';
import { daisyOrganizationId } from '../src/daisy-reference';
import {
  scratchDatabase,
  ddlTimeoutMs,
} from './scratch-migrations.test-support';
import { integrationSuite } from './suite.test-support';
const { databaseUrl } = integrationSuite();
const scratch = scratchDatabase(databaseUrl, 'ballotsource');
const migration = '20261116175854_tab_wiring';
afterAll(() => scratch.drop());

test(
  'DEC408 source migration preserves actual historical Daisy content and requires real stored versions',
  async () => {
    await scratch.create();
    await scratch.migrate((tag) => tag < migration);
    const sql = new SQL(scratch.url, { max: 1 });
    try {
      const fixture = new Fixture(sql);
      const legacy = {
        ballot: daisyWinnerBallot,
        panel: panelRuleFor(daisyWinnerBallot),
      };
      const roundId = await fixture.round({ judging: legacy });
      const [before] =
        await sql`select to_jsonb(r) as row from rounds r where id=${roundId}`;
      await scratch.migrate(() => true);
      const [after] =
        await sql`select to_jsonb(r)-'ballot_definition_id'-'ballot_definition_version' as row from rounds r where id=${roundId}`;
      const id = createId();
      await sql.unsafe('begin');
      await fixture.insert('ballot_definitions', {
        id,
        organization_id: daisyOrganizationId,
        name: 'Canonical source migration proof',
        current_version: 1,
      });
      await fixture.insert(
        'ballot_definition_versions',
        {
          ballot_definition_id: id,
          version: 1,
          organization_id: daisyOrganizationId,
          definition: {
            ...daisyWinnerBallot,
            key: 'canonical-source-proof',
            revision: 1,
          },
        },
        'ballot_definition_id',
      );
      await sql.unsafe('commit');
      const stored = {
        source: { kind: 'stored', id, version: 1 },
        ballot: {
          ...daisyWinnerBallot,
          key: 'canonical-source-proof',
          revision: 1,
        },
        panel: panelRuleFor(daisyWinnerBallot),
      };
      const storedRound = await fixture.round({ judging: stored });
      const [pin] =
        await sql`select ballot_definition_id,ballot_definition_version from rounds where id=${storedRound}`;
      const constraint = async (judging: unknown) => {
        try {
          await fixture.round({ judging });
          return null;
        } catch (error) {
          return (error as { constraint?: string }).constraint ?? 'other-error';
        }
      };
      assert({
        given:
          'a real pre-source Daisy Round and an actual immutable stored definition version',
        should:
          'preserve every historical field, derive only its original source and require real complete stored pins',
        actual: {
          row: after?.row,
          pin,
          refusals: [
            await constraint(legacy),
            await constraint({
              ...stored,
              source: { ...stored.source, id: createId() },
            }),
          ],
        },
        expected: {
          row: {
            ...before?.row,
            judging: {
              ...legacy,
              source: {
                kind: 'daisy',
                key: daisyWinnerBallot.key,
                revision: daisyWinnerBallot.revision,
              },
            },
          },
          pin: { ballot_definition_id: id, ballot_definition_version: 1 },
          refusals: [
            'rounds_judging_source_check',
            'rounds_ballot_definition_fk',
          ],
        },
      });
    } finally {
      await sql.close();
    }
  },
  ddlTimeoutMs,
);
