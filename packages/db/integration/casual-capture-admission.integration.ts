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

test('casual captures are capped per host and fleet-wide', async () => {
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
      const stranger = async () => f.actor(await f.user());
      assert({
        given: 'nothing running',
        should: 'admit',
        actual: await answer(host),
        expected: undefined,
      });
      for (let i = 0; i < CASUAL_CAPTURES_AT_ONCE; i += 1)
        await running(await stranger());
      await assertRejects({
        given: 'a new host with the fleet at its casual cap',
        should: 'refuse by name',
        code: 'CONFLICT',
        reason: 'capture-capacity',
        actual: async () => answer(await stranger()),
      });
      for (let i = 0; i < CASUAL_CAPTURES_PER_HOST; i += 1) await running(host);
      await assertRejects({
        given: 'a host at the per-host cap',
        should: 'refuse by name',
        code: 'CONFLICT',
        reason: 'capture-host-limit',
        actual: () => answer(host),
      });
    });
  } finally {
    await client.close();
  }
});

test('a live ranked Round refuses casual capture, and is never counted against itself', async () => {
  const client = new SQL(databaseUrl, { max: 2 });
  const db = drizzle({ client });
  try {
    await withFixture(databaseUrl, async (f) => {
      const host = await f.actor(await f.user());
      await f.round({
        status: 'active',
        current_stage: 'live',
        started_at: new Date(),
        resolution: 'A resolution',
        capture,
        created_by_actor_id: host,
        competition_type: 'ranked',
        format_id: 'freestyle',
        ladder_id: 'freestyle',
        preset_version: 1,
        visibility: 'public',
      });
      await assertRejects({
        given: 'one Egress machine and a ranked Round live',
        should: 'refuse casual capture, since ranked comes first',
        code: 'CONFLICT',
        reason: 'capture-capacity',
        actual: async () =>
          db.transaction((tx) =>
            admitCasualCapture(tx as never, {
              hostActorId: host,
              roundId: createId(),
            }),
          ),
      });
    });
  } finally {
    await client.close();
  }
});
