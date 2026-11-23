import { SQL } from 'bun';
import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import {
  daisyWinnerBallot,
  panelRuleFor,
} from '@daisy/protocol/ballot-definition';
import { assert, test } from 'riteway/bun';
import { Fixture } from './constraint-helpers';
import { daisyOrganizationId } from '../src/daisy-reference';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import { integrationSuite } from './suite.test-support';

const { databaseUrl } = integrationSuite();
// Stored ballot definition versions are append-only: a scratch database
// holds them and is dropped after the suite.
const scratch = scratchDatabase(databaseUrl, 'ballotsource');
afterAll(() => scratch.drop());

test(
  'DEC408: a Round’s judging names its ballot source and pins a real stored version',
  async () => {
    await scratch.create();
    await scratch.migrate(() => true);
    const sql = new SQL(scratch.url, { max: 1 });
    const fixture = new Fixture(sql);
    try {
      const id = createId();
      const definition = {
        ...daisyWinnerBallot,
        key: 'canonical-source-proof',
        revision: 1,
      };
      await sql.unsafe('begin');
      await fixture.insert('ballot_definitions', {
        id,
        organization_id: daisyOrganizationId,
        name: 'Canonical source proof',
        current_version: 1,
      });
      await fixture.insert(
        'ballot_definition_versions',
        {
          ballot_definition_id: id,
          version: 1,
          organization_id: daisyOrganizationId,
          definition,
        },
        'ballot_definition_id',
      );
      await sql.unsafe('commit');
      const stored = {
        source: { kind: 'stored', id, version: 1 },
        ballot: definition,
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
          'a Round judged on an immutable stored definition version, one with no source and one naming a missing definition',
        should:
          'pin the stored version and refuse the sourceless and the dangling judging',
        actual: {
          pin,
          refusals: [
            await constraint({
              ballot: daisyWinnerBallot,
              panel: panelRuleFor(daisyWinnerBallot),
            }),
            await constraint({
              ...stored,
              source: { ...stored.source, id: createId() },
            }),
          ],
        },
        expected: {
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
