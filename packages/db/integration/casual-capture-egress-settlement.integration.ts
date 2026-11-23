import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, test } from 'riteway/bun';
import { isAppError } from '@daisy/errors';
import { admitCasualCapture } from '../src/casual-capture-admission';
import { readNonrankedCaptureCapacity } from '../src/nonranked-capture-capacity';
import { withFixture } from './constraint-helpers';
import { integrationSuite } from './suite.test-support';

const { databaseUrl } = integrationSuite();
const at = new Date('2026-11-01T10:00:00Z');
const ended = new Date('2026-11-01T11:00:00Z');

test('unsettled Egress of over Rounds holds casual capture capacity until it settles', async () => {
  const sql = new SQL(databaseUrl, { max: 2 });
  const db = drizzle({ client: sql });
  try {
    await withFixture(databaseUrl, async (f) => {
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
      const host = await f.actor(await f.user());
      const capacity = async () => {
        const { running, hosted } = await db.transaction((tx) =>
          readNonrankedCaptureCapacity(tx as never, {
            roundId: createId(),
            hostActorId: host,
            sponsorUserId: null,
            lobbyId: null,
          }),
        );
        return { running, hosted };
      };
      const capture = { broadcast: null, recordingPolicy: 'released' };
      const overRound = (status: 'completed' | 'abandoned') =>
        f.round({
          status,
          started_at: at,
          completed_at: ended,
          capture,
          created_by_actor_id: host,
        });
      const before = await capacity();
      const broadcasts: string[] = [];
      const recording = createId();
      try {
        // Over Rounds whose observer is revoked and Egress recorded, never settled.
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
        assert({
          given:
            'four broadcasts and a capture of over Rounds with unsettled Egress',
          should: "hold five slots, the host's own cap among them",
          actual: [await capacity(), await admit(host)],
          expected: [
            { running: before.running + 5, hosted: 5 },
            'capture-host-limit',
          ],
        });
        await sql`update broadcasts set egress_settled_at = completed_at where id in ${sql(broadcasts)}`;
        await sql`update recording_captures set egress_settled_at = ended_at where recording_id = ${recording}`;
        assert({
          given: 'the same Egress settled',
          should: 'hold nothing and admit a casual capture',
          actual: [await capacity(), await admit(host)],
          expected: [before, 'admitted'],
        });
      } finally {
        // The fixture purges Rounds; their capture rows restrict that.
        await sql`delete from recording_captures where recording_id = ${recording}`;
        await sql`delete from recordings where id = ${recording}`;
        await sql`delete from broadcasts where id in ${sql(broadcasts.length ? broadcasts : [''])}`;
      }
    });
  } finally {
    await sql.close();
  }
});
