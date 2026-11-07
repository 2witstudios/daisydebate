import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withFixture, sqlStateOf } from './constraint-helpers';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('worker discovery reads only routing columns and cannot read payload or acquire competitive DML', () =>
  withFixture(databaseUrl, async (f) => {
    const roundId = await f.round();
    const id = createId();
    await f.insert('necessary_evidence', {
      id,
      round_id: roundId,
      original_round_id: roundId,
      session_id: createId(),
      segment_id: createId(),
      round_participant_id: createId(),
      worker_id: createId(),
      capture_epoch: 1,
      binding_digest: 'b'.repeat(64),
      reserved_bytes: 1,
    });
    try {
      const rows = await f.sql.begin(async (tx) => {
        await tx`set local role daisy_media_worker`;
        return tx`select id,state from necessary_evidence where id=${id}`;
      });
      const refusals = [];
      for (const statement of [
        'select ciphertext from necessary_evidence where id=$1',
        'select lease_digest from necessary_evidence where id=$1',
        'select payload_accepted_at from necessary_evidence where id=$1',
        'select original_subject_actor_ids from necessary_evidence where id=$1',
        'select original_speaker from necessary_evidence where id=$1',
        'select actor_id from necessary_evidence_erasure_requests where actor_id=$1',
        'select execution_worker_id from necessary_evidence where id=$1',
        'select withdrawn_at from necessary_evidence_round_fences where round_id=$1',
        'update necessary_evidence set reserved_bytes=2 where id=$1',
        'delete from necessary_evidence where id=$1',
      ])
        refusals.push(
          await sqlStateOf(() =>
            f.sql.begin(async (tx) => {
              await tx`set local role daisy_media_worker`;
              return tx.unsafe(statement, [id]);
            }),
          ),
        );
      assert({
        given: 'the existing read-only media worker principal',
        should:
          'discover bounded work by routing only while payload, execution secret and DML remain forbidden',
        actual: { rows: [...rows], refusals },
        expected: {
          rows: [{ id, state: 'acquiring' }],
          refusals: [
            '42501',
            '42501',
            '42501',
            '42501',
            '42501',
            '42501',
            '42501',
            '42501',
            '42501',
            '42501',
          ],
        },
      });
    } finally {
      await f.sql`delete from necessary_evidence where id=${id}`;
    }
  }));

test('approved Round deleters retire opaque evidence under their existing invoker rights', () =>
  withFixture(databaseUrl, async (f) => {
    const roundId = await f.round(),
      id = createId();
    await f.insert('necessary_evidence', {
      id,
      round_id: roundId,
      original_round_id: roundId,
      session_id: createId(),
      segment_id: createId(),
      round_participant_id: createId(),
      worker_id: createId(),
      capture_epoch: 1,
      binding_digest: 'b'.repeat(64),
      reserved_bytes: 1,
    });
    try {
      const missing =
        await f.sql`select rolname from pg_roles where not rolsuper and has_table_privilege(oid,'rounds','DELETE') and not has_table_privilege(oid,'necessary_evidence','UPDATE')`;
      await f.sql.begin(async (tx) => {
        await tx`set local role daisy_web`;
        await tx`delete from rounds where id=${roundId}`;
      });
      const [row] =
        await f.sql`select round_id,state,retirement_reason,reserved_bytes from necessary_evidence where id=${id}`;
      assert({
        given:
          'all currently approved non-superuser Round-delete principals and an actual web-role aggregate deletion with an opaque pending intent',
        should:
          'retire cleanup routing under existing invoker privileges without adding a speculative SECURITY DEFINER escalation',
        actual: { missing: Array.from(missing), row },
        expected: {
          missing: [],
          row: {
            round_id: null,
            state: 'retiring',
            retirement_reason: 'erased',
            reserved_bytes: 0,
          },
        },
      });
    } finally {
      await f.sql`delete from necessary_evidence where id=${id}`;
    }
  }));
