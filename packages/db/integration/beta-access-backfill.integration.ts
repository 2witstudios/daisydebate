import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

/** The backfill migration's own statement, as the migrator runs it. */
const backfill = () => {
  const root = join(import.meta.dir, '..', 'migrations');
  const folder = readdirSync(root).find((name) =>
    name.endsWith('_beta_access_backfill_pending'),
  );
  return readFileSync(join(root, folder!, 'migration.sql'), 'utf8');
};

class RolledBack extends Error {}

test('a claimed account left without a beta row is backfilled as pending, once (ISSUE-654)', async () => {
  await withFixture(url, async (fixture) => {
    // A claimed human account with no row, as an old binary left it.
    const orphan = await fixture.user();
    await fixture.actor(orphan);
    // An erased account and an approved one are not touched.
    const erased = await fixture.user();
    await fixture.actor(erased);
    await fixture.sql`update users set username = null, deleted_at = now(), version = version + 1 where id = ${erased}`;
    const approved = await fixture.user();
    await fixture.actor(approved);
    await fixture.sql`insert into account_beta_access (user_id, state, requested_at, decided_at, provenance) values (${approved}, 'approved', now(), now(), 'signup')`;
    let observed: unknown;
    // Read inside, then roll back: the shared database keeps no backfill.
    await fixture.sql
      .begin(async (tx) => {
        await tx.unsafe(backfill());
        await tx.unsafe(backfill());
        const rows =
          await tx`select b.user_id, b.state, b.revision, b.provenance, b.requested_at = u.created_at as requested_when_joined from account_beta_access b join users u on u.id = b.user_id where b.user_id in (${orphan}, ${erased}, ${approved}) order by b.state`;
        const events =
          await tx`select user_id, to_state, principal from account_access_events where user_id in (${orphan}, ${erased}, ${approved})`;
        observed = { rows: [...rows], events: [...events] };
        throw new RolledBack();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RolledBack)) throw error;
      });
    assert({
      given:
        'a claimed account without a row, an erased one and an approved one, with the backfill run twice',
      should:
        'add one pending row requested when the account joined, with one migration event, and touch nothing else',
      actual: observed,
      expected: {
        rows: [
          {
            user_id: approved,
            state: 'approved',
            revision: 1,
            provenance: 'signup',
            requested_when_joined: false,
          },
          {
            user_id: orphan,
            state: 'pending',
            revision: 1,
            provenance: 'signup',
            requested_when_joined: true,
          },
        ],
        events: [
          {
            user_id: orphan,
            to_state: 'pending',
            principal: 'migration:beta_access_backfill_pending',
          },
        ],
      },
    });
  });
});
