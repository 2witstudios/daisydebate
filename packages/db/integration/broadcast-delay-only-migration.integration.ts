import { SQL } from 'bun';
import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { rejectedBy, withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const migration = '20261103173009_puzzling_malcolm_colcord';
const check = 'broadcasts_release_policy_check';
const longest = { kind: 'delay', seconds: 86_400 };
const scratch = scratchDatabase(url, 'delayonly');

afterAll(() => scratch.drop());

test(
  'a stored Round-end or set-time release becomes the longest delay, and no other row changes',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    const sql = new SQL(scratch.url, { max: 1 });
    try {
      await withFixture(scratch.url, async (f) => {
        const capture = (release: unknown) =>
          JSON.stringify({
            broadcast: { release, debatersReadChat: true },
            recording: false,
          });
        const format = await f.format();
        const room = await f.room(await f.actor(), format);
        const round = () => f.round({ format_id: format });
        const open = async (roundId: string, policy: unknown) =>
          sql`insert into broadcasts (id, round_id, feed_key, release_policy)
            values (${createId()}, ${roundId}, ${createId()}, ${JSON.stringify(policy)}::text::jsonb)`;
        const [held, scheduled, delayed] = [
          await round(),
          await round(),
          await round(),
        ];
        await open(held, { kind: 'round_end' });
        await open(scheduled, { kind: 'at', atMs: 1 });
        await open(delayed, { kind: 'delay', seconds: 10 });
        await sql`update rounds set capture=${capture({ kind: 'round_end' })}::text::jsonb where id=${held}`;
        await sql`update rooms set capture=${capture({ kind: 'at', atMs: 1 })}::text::jsonb where id=${room}`;
        const seeded = { held, scheduled, delayed, room };
        await scratch.migrate((folder) => folder <= migration);
        const policy = async (roundId: string) =>
          (
            await sql<
              { release_policy: unknown }[]
            >`select release_policy from broadcasts where round_id=${roundId}`
          )[0]?.release_policy;
        assert({
          given: 'a hold for the end, a set time and a delay',
          should:
            'turn the first two into the longest delay, and keep the third',
          actual: [
            await policy(seeded.held),
            await policy(seeded.scheduled),
            await policy(seeded.delayed),
          ],
          expected: [longest, longest, { kind: 'delay', seconds: 10 }],
        });
        assert({
          given: 'the choice a Round and a Room stored',
          should: 'rewrite the release and keep the rest of the choice',
          actual: [
            (
              await sql<
                { capture: unknown }[]
              >`select capture from rounds where id=${seeded.held}`
            )[0]?.capture,
            (
              await sql<
                { capture: unknown }[]
              >`select capture from rooms where id=${seeded.room}`
            )[0]?.capture,
          ],
          expected: Array(2).fill({
            broadcast: { release: longest, debatersReadChat: true },
            recording: false,
          }),
        });
        assert({
          given: 'the migrated check',
          should: 'refuse any release but a delay',
          actual: await rejectedBy(
            () =>
              sql`update broadcasts set release_policy='{"kind":"round_end"}'::jsonb where round_id=${seeded.delayed}`,
          ),
          expected: check,
        });
      });
    } finally {
      await sql.close();
    }
  },
  ddlTimeoutMs,
);
