import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { readObservationHeaders } from '../src/observation-headers';
import {
  withFixture,
  roundAuthoring,
  createScheduledRound,
} from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('a mid-transaction flush still flushes later changes once at commit', async () => {
  await withFixture(url, async (fixture) => {
    const authoring = await roundAuthoring(fixture, url);
    await createScheduledRound(authoring, 'Flush proof');
    const resource = { kind: 'round' as const, id: authoring.roundId };
    const read = async () =>
      (
        await readObservationHeaders(drizzle({ client: fixture.sql }), [
          resource,
        ])
      )[0]!.contentRevision;
    const initial = await read();
    const pending = await fixture.sql.begin(async (tx) => {
      await tx`update rounds set resolution='Before immediate flush',version=version+1 where id=${resource.id}`;
      await tx`set constraints all immediate`;
      await tx`set constraints all deferred`;
      await tx`update rounds set resolution='After immediate flush',version=version+1 where id=${resource.id}`;
      const [row] =
        await tx`select count(*)::int as n from resource_observation_pending`;
      return row!.n;
    });
    const [left] =
      await fixture.sql`select count(*)::int as n from resource_observation_pending`;
    assert({
      given: 'a change, an immediate flush, then another change before commit',
      should:
        'advance content once per flush and leave no pending dirt after commit',
      actual: { advanced: (await read()) - initial, pending, left: left!.n },
      expected: { advanced: 2, pending: 1, left: 0 },
    });
  });
});
