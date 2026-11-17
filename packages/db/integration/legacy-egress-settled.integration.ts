import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, test } from 'riteway/bun';
import { isAppError } from '@daisy/errors';
import { admitCasualCapture } from '../src/casual-capture-admission';
import { readNonrankedCaptureCapacity } from '../src/nonranked-capture-capacity';
import { Fixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import { integrationSuite } from './suite.test-support';

const { databaseUrl } = integrationSuite();
const scratch = scratchDatabase(databaseUrl, 'legacyegress');
afterAll(() => scratch.drop());

const settling = '20261117195735_tab_legacy_egress_settled';
const at = new Date('2026-11-01T10:00:00Z');
const ended = new Date('2026-11-01T11:00:00Z');

test(
  'pre-Tab Egress of over Rounds settles at its own end and frees casual capture capacity',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < settling);
    const sql = new SQL(scratch.url, { max: 2 });
    const db = drizzle({ client: sql });
    const f = new Fixture(sql);
    const admit = (hostActorId: string) =>
      db
        .transaction((tx) =>
          admitCasualCapture(tx as never, {
            hostActorId,
            roundId: createId(),
          }),
        )
        .then(
          () => 'admitted',
          (error: unknown) => {
            if (isAppError(error)) return error.reason ?? error.code;
            throw error;
          },
        );
    try {
      const host = await f.actor(await f.user());
      const capture = { broadcast: null, recordingPolicy: 'released' };
      const overRound = (status: 'completed' | 'abandoned') =>
        f.round({
          status,
          started_at: at,
          completed_at: ended,
          capture,
          created_by_actor_id: host,
        });
      // Staging's shape: completed, observer revoked, Egress recorded, nothing dispatched.
      const broadcasts: string[] = [];
      for (const status of [
        'completed',
        'completed',
        'abandoned',
        'completed',
      ] as const) {
        const id = createId();
        broadcasts.push(id);
        await sql`insert into broadcasts (id, round_id, feed_key, release_policy, egress_id, egress_generation, egress_started_at, observer_revoked_at, stream_ended_at, completed_at, feed_withdrawn_at)
          values (${id}, ${await overRound(status)}, ${createId()}, ${JSON.stringify({ kind: 'delay', seconds: 60 })}::text::jsonb, ${`EG_${id}`}, 1, ${at}, ${ended}, ${ended}, ${ended}, ${ended})`;
      }
      const recording = createId();
      const captureRound = await overRound('completed');
      await f.insert('recordings', {
        id: recording,
        round_id: captureRound,
        recording_class: 'casual',
        eligibility: { kind: 'host_opt_in', hostActorId: host },
        status: 'requested',
        lifecycle: { status: 'requested' },
      });
      await sql`insert into recording_captures (recording_id, round_id, egress_id, egress_generation, egress_started_at, observer_revoked_at, ended_at)
        values (${recording}, ${captureRound}, 'EG_capture', 1, ${at}, ${ended}, ${ended})`;
      const capacity = () =>
        db.transaction((tx) =>
          readNonrankedCaptureCapacity(tx as never, {
            roundId: createId(),
            hostActorId: host,
            sponsorUserId: null,
            lobbyId: null,
          }),
        );
      const stranger = await f.actor(await f.user());

      assert({
        given: 'pre-Tab captures of over Rounds before the settling folder',
        should: 'count every one as held, as staging did',
        actual: [
          await capacity(),
          await admit(host),
          await admit(stranger),
        ],
        expected: [
          { running: 5, hosted: 5, sponsored: 0, tournament: 0 },
          'capture-host-limit',
          'capture-capacity',
        ],
      });

      await scratch.migrate(() => true);
      // The migrator applies a folder once; its statements must also be safe to repeat.
      let repeated = 0;
      for (const statement of (
        await Bun.file(
          new URL(`../migrations/${settling}/migration.sql`, import.meta.url),
        ).text()
      ).split('--> statement-breakpoint'))
        repeated += (await sql.unsafe(statement)).count;

      assert({
        given: 'the settling folder applied, then its statements run again',
        should: 'settle each at its own completion or end, and change nothing more',
        actual: [
          repeated,
          ...(
            await sql`select egress_settled_at from broadcasts where id in ${sql(broadcasts)}`
          ).map((r: { egress_settled_at: Date }) => r.egress_settled_at),
          ...(
            await sql`select egress_settled_at from recording_captures where recording_id = ${recording}`
          ).map((r: { egress_settled_at: Date }) => r.egress_settled_at),
        ],
        expected: [0, ...Array.from({ length: 5 }, () => ended)],
      });
      assert({
        given: 'only settled pre-Tab Egress',
        should: 'hold nothing and admit a casual capture',
        actual: [await capacity(), await admit(host), await admit(stranger)],
        expected: [
          { running: 0, hosted: 0, sponsored: 0, tournament: 0 },
          'admitted',
          'admitted',
        ],
      });
    } finally {
      await sql.close();
    }
  },
  ddlTimeoutMs * 4,
);
