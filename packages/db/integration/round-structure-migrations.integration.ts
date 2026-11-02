import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { SQL } from 'bun';
import { Fixture, rejectedBy } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const noVoid = '20261102231940_round_completion_structure';
const cutoffName = '20261102231940_round_completion_structure';
const scratch = scratchDatabase(databaseUrl, 'roundstructure');
afterAll(() => scratch.drop());

test(
  'a voided ballot and a stored cutoff decision cannot refuse the deploy (ISSUE-997, ISSUE-988)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < noVoid);
    const client = new SQL(scratch.url);
    const f = new Fixture(client);
    try {
      const at = new Date('2026-10-31T16:00:00.000Z');
      const roundId = await f.round({
        status: 'active',
        current_stage: 'live',
        started_at: at,
      });
      await f.freeze(roundId);
      const seat = await f.seat(roundId, 'judge');
      const ballotId = createId();
      await f.insert('ballots', {
        id: ballotId,
        judge_participant_id: seat.id,
        round_id: roundId,
        freeze_revision: 1,
        rubric_version: 'speaker-10@1',
        winner: 'affirmative',
        scores: {},
        reason: 'Stronger evidence',
        status: 'voided',
        submitted_at: at,
        voided_at: at,
        voided_by_actor_id: await f.actor(),
      });
      const segmentId = createId();
      await f.insert('round_segments', {
        id: segmentId,
        round_id: roundId,
        sequence: 0,
        type: 'speech',
        rules_segment_key: 'first',
        started_at: at,
        duration_ms: 60_000,
      });
      const commandId = createId();
      await f.insert(
        'round_commands',
        {
          command_id: commandId,
          round_id: roundId,
          service_id: `round-attendance:${createId()}`,
          type: 'adjudicate',
          payload_digest: 'a'.repeat(64),
          result: {},
          resulting_version: 1,
          applied_at: at,
        },
        'command_id',
      );
      await client`insert into round_attendance_adjudications(round_id,segment_id,command_id,decision,evidence)
        values(${roundId},${segmentId},${commandId},'abandoned','infrastructure_unresolved')`;
      await scratch.migrate((folder) => folder <= cutoffName);
      const [ballot] =
        await client`select status from ballots where id=${ballotId}`;
      const [row] =
        await client`select evidence from round_attendance_adjudications where segment_id=${segmentId}`;
      assert({
        given: 'rows the old schema allowed',
        should: 'migrate both, under the new names',
        actual: { ballot: ballot.status, evidence: row.evidence },
        expected: { ballot: 'submitted', evidence: 'resolution_cutoff' },
      });
      assert({
        given: 'a stored decision after the rename',
        should: 'be immutable again',
        actual:
          await client`update round_attendance_adjudications set evidence='resolution_cutoff' where segment_id=${segmentId}`.then(
            () => 'accepted',
            () => 'refused',
          ),
        expected: 'refused',
      });
      assert({
        given: 'a ballot marked voided',
        should: 'refuse it',
        actual: await rejectedBy(
          () => client`update ballots set status='voided' where id=${ballotId}`,
        ),
        expected: 'ballots_status_check',
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
