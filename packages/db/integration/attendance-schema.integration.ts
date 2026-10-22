import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectedBy, withFixture } from './constraint-helpers';
import { captureSchemaStream } from './capture-schema.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('pending check-in markers and immutable facts keep global receipt and owning Round integrity', async () => {
  await withFixture(url, async (fixture) => {
    const { roundId, seat, segmentId } = await captureSchemaStream(fixture);
    const commandId = createId(),
      attemptId = createId();
    try {
      const [backend] =
        await fixture.sql`select pg_backend_pid() as pid, backend_start::text as started from pg_stat_activity where pid=pg_backend_pid()`;
      await fixture.sql.unsafe(
        'insert into round_check_in_attempts(attempt_id,command_id,round_id,received_at,backend_pid,backend_started_at,payload_digest,actor_id) values($1,$2,$3,statement_timestamp(),$4,$5::timestamptz,$6,$7)',
        [
          attemptId,
          commandId,
          roundId,
          backend!.pid,
          backend!.started,
          'a'.repeat(64),
          seat.actorId,
        ],
      );
      assert({
        given: 'a durable pending attempt before command acceptance',
        should: 'need no ledger row and retain exact backend incarnation',
        actual: (
          await fixture.sql.unsafe(
            'select state,backend_started_at::text as started from round_check_in_attempts where attempt_id=$1',
            [attemptId],
          )
        )[0],
        expected: { state: 'pending', started: backend!.started },
      });
      assert({
        given: 'a pending durable marker before its outcome is known',
        should: 'refuse pruning or replacing its authenticated payload',
        actual: await Promise.all([
          rejectedBy(() =>
            fixture.sql.unsafe(
              'delete from round_check_in_attempts where attempt_id=$1',
              [attemptId],
            ),
          ),
          rejectedBy(() =>
            fixture.sql.unsafe(
              'update round_check_in_attempts set payload_digest=$2 where attempt_id=$1',
              [attemptId, 'b'.repeat(64)],
            ),
          ),
        ]),
        expected: [
          'round_check_in_attempts_pending',
          'round_check_in_attempts_immutable',
        ],
      });
      await fixture.insert(
        'round_commands',
        {
          command_id: commandId,
          round_id: roundId,
          actor_id: seat.actorId,
          type: 'check_in',
          payload_digest: 'a'.repeat(64),
          result: {},
          resulting_version: 1,
          applied_at: new Date(1000),
        },
        'command_id',
      );
      await fixture.sql.unsafe(
        'insert into round_check_ins(command_id,round_id,segment_id,participant_id,received_at) select command_id,round_id,$2,$3,received_at from round_check_in_attempts where attempt_id=$1',
        [attemptId, segmentId, seat.id],
      );
      await fixture.sql.unsafe(
        "update round_check_in_attempts set state='committed',resolved_at=clock_timestamp() where attempt_id=$1",
        [attemptId],
      );
      assert({
        given: 'a resolved attempt or first check-in receipt',
        should: 'refuse reopening or stamp rewrites',
        actual: await Promise.all([
          rejectedBy(() =>
            fixture.sql.unsafe(
              "update round_check_in_attempts set state='pending',resolved_at=null where attempt_id=$1",
              [attemptId],
            ),
          ),
          rejectedBy(() =>
            fixture.sql.unsafe(
              'update round_check_ins set received_at=clock_timestamp() where command_id=$1',
              [commandId],
            ),
          ),
        ]),
        expected: [
          'round_check_in_attempts_immutable',
          'round_check_ins_immutable',
        ],
      });
      assert({
        given: 'an actor attempting service-only attendance adjudication',
        should: 'refuse the principal mismatch',
        actual: await rejectedBy(() =>
          fixture.insert(
            'round_commands',
            {
              command_id: createId(),
              round_id: roundId,
              actor_id: seat.actorId,
              type: 'adjudicate',
              payload_digest: 'c'.repeat(64),
              result: {},
              resulting_version: 1,
              applied_at: new Date(2000),
            },
            'command_id',
          ),
        ),
        expected: 'round_commands_attendance_principal_check',
      });
      const adjudicate = createId();
      await fixture.insert(
        'round_commands',
        {
          command_id: adjudicate,
          round_id: roundId,
          service_id: `round-attendance:${createId()}`,
          type: 'adjudicate',
          payload_digest: 'b'.repeat(64),
          result: {},
          resulting_version: 1,
          applied_at: new Date(2000),
        },
        'command_id',
      );
      await fixture.sql.unsafe(
        "insert into round_attendance_adjudications(round_id,segment_id,command_id,decision,effective_deadline,settled_horizon) values($1,$2,$3,'none',statement_timestamp(),statement_timestamp())",
        [roundId, segmentId, adjudicate],
      );
      assert({
        given: 'an irreversible attendance decision including none',
        should: 'refuse direct delete or outcome rewrite',
        actual: await Promise.all([
          rejectedBy(() =>
            fixture.sql.unsafe(
              'delete from round_attendance_adjudications where segment_id=$1',
              [segmentId],
            ),
          ),
          rejectedBy(() =>
            fixture.sql.unsafe(
              "update round_attendance_adjudications set decision='forfeit' where segment_id=$1",
              [segmentId],
            ),
          ),
        ]),
        expected: [
          'round_attendance_adjudications_immutable',
          'round_attendance_adjudications_immutable',
        ],
      });
      let reachedCommit = false;
      const refusal = await rejectedBy(() =>
        fixture.sql.begin(async (tx) => {
          await tx.unsafe('delete from round_commands where command_id=$1', [
            commandId,
          ]);
          reachedCommit = true;
        }),
      );
      assert({
        given: 'receipt retention while a durable check-in references it',
        should: 'refuse at commit without erasing attendance evidence',
        actual: { reachedCommit, refusal },
        expected: {
          reachedCommit: true,
          refusal: 'round_check_ins_command_round_fk',
        },
      });
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
      assert({
        given: 'owning Round erasure',
        should: 'cascade attendance facts and markers',
        actual: await Promise.all(
          [
            'round_check_ins',
            'round_attendance_adjudications',
            'round_check_in_attempts',
          ].map((table) => fixture.count(table, 'round_id', roundId)),
        ),
        expected: [0, 0, 0],
      });
    } finally {
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
    }
  });
});
