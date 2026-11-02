import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { SQL } from 'bun';
import { Fixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const budget = '20261102023652_overrated_silver_samurai';
const cutoff = '20261102024123_tearful_starfox';
const scratch = scratchDatabase(databaseUrl, 'roundcompletion');
afterAll(() => scratch.drop());

test(
  'existing judging jobs and ended Rounds gain their deadlines from their own recorded times',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < budget);
    const client = new SQL(scratch.url);
    const f = new Fixture(client);
    try {
      const frozenAt = '2026-10-31T17:02:43.775Z';
      const finalEnd = '2026-10-31T17:02:40.012Z';
      const ended = await f.round({
        status: 'active',
        current_stage: 'live',
        started_at: new Date('2026-10-31T16:00:00.000Z'),
        final_segment_ended_at: new Date(finalEnd),
        transcript_admission_cutoff: new Date(Date.parse(finalEnd) + 120_000),
      });
      const live = await f.round({
        status: 'active',
        current_stage: 'live',
        started_at: new Date('2026-10-31T16:00:00.000Z'),
      });
      const judge = createId();
      await f.insert('round_participants', {
        id: judge,
        round_id: ended,
        actor_id: await f.actor(),
        role: 'judge',
        slot: 0,
      });
      await client`insert into round_transcript_freezes(round_id,revision,frontier,completeness,frozen_at) values(${ended},1,0,'complete',${frozenAt}::timestamptz)`;
      await client`insert into round_judging_jobs(round_id,judge_participant_id,freeze_revision,status) values(${ended},${judge},1,'failed')`;
      await scratch.migrate((folder) => folder <= cutoff);
      const [job] =
        await client`select to_char(generation_deadline_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as deadline,terminal_reason,status from round_judging_jobs where round_id=${ended}`;
      const rows =
        await client`select id,to_char(attendance_resolution_cutoff_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as cutoff from rounds where id in (${ended},${live})`;
      const cutoffOf = (id: string) =>
        rows.find((row: { id: string }) => row.id === id)?.cutoff;
      assert({
        given: 'a failed job and an ended Round from before these migrations',
        should:
          'derive each deadline from recorded times, invent no terminal reason, and leave an unended Round with no cutoff',
        actual: {
          deadline: job.deadline,
          reason: job.terminal_reason,
          status: job.status,
          ended: cutoffOf(ended),
          live: cutoffOf(live),
        },
        expected: {
          deadline: '2026-10-31T17:07:43.775Z',
          reason: null,
          status: 'failed',
          ended: '2026-10-31T18:02:40.012Z',
          live: null,
        },
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
