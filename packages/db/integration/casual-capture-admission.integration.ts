import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  admitCasualCapture,
  CASUAL_CAPTURES_AT_ONCE,
  CASUAL_CAPTURES_PER_HOST,
} from '../src/casual-capture-admission';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const capture = { broadcast: null, recording: true };

test('casual captures are capped per host and fleet-wide, and ranked counts for neither', async () => {
  const client = new SQL(databaseUrl, { max: 2 });
  const db = drizzle({ client });
  try {
    await withFixture(databaseUrl, async (f) => {
      const running = (hostActorId: string, over: object = {}) =>
        f.round({
          status: 'active',
          current_stage: 'live',
          started_at: new Date(),
          resolution: 'A resolution',
          capture,
          created_by_actor_id: hostActorId,
          ...over,
        });
      const host = await f.actor(await f.user());
      const answer = (hostActorId: string) =>
        db.transaction((tx) =>
          admitCasualCapture(tx as never, {
            hostActorId,
            roundId: createId(),
          }),
        );
      for (let i = 0; i < CASUAL_CAPTURES_PER_HOST - 1; i += 1)
        await running(host);
      await running(host, {
        competition_type: 'ranked',
        format_id: 'freestyle',
        ladder_id: 'freestyle',
        preset_version: 1,
        visibility: 'public',
      });
      assert({
        given: 'a host one under the cap, with a ranked Round besides',
        should: 'admit, since ranked is not counted',
        actual: await answer(host),
        expected: undefined,
      });
      await running(host);
      await assertRejects({
        given: 'that host at the cap',
        should: 'refuse by name',
        code: 'CONFLICT',
        reason: 'capture-host-limit',
        actual: () => answer(host),
      });
      for (let i = 0; i < CASUAL_CAPTURES_AT_ONCE; i += 1)
        await running(await f.actor(await f.user()));
      await assertRejects({
        given: 'a new host with the fleet at its casual cap',
        should: 'refuse by name',
        code: 'CONFLICT',
        reason: 'capture-capacity',
        actual: async () => answer(await f.actor(await f.user())),
      });
    });
  } finally {
    await client.close();
  }
});
