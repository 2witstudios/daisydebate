import { afterAll } from 'bun:test';
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
const check = '20261102222436_attendance_cutoff_always_held';
const scratch = scratchDatabase(databaseUrl, 'attendancecutoff');
afterAll(() => scratch.drop());

const finalEnd = '2026-10-31T17:02:40.012Z';
const admission = new Date(Date.parse(finalEnd) + 120_000);
const cutoff = new Date(Date.parse(finalEnd) + 60 * 60_000);

test(
  'a Round whose final speech ended always holds its attendance cutoff (ISSUE-982)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < check);
    const client = new SQL(scratch.url);
    const f = new Fixture(client);
    try {
      const live = {
        status: 'active',
        current_stage: 'live',
        started_at: new Date('2026-10-31T16:00:00.000Z'),
      };
      const played = {
        ...live,
        final_segment_ended_at: new Date(finalEnd),
        transcript_admission_cutoff: admission,
      };
      const missing = await f.round(played);
      const wrong = await f.round({
        ...played,
        attendance_resolution_cutoff_at: new Date(Date.parse(finalEnd) + 1),
      });
      const stray = await f.round({
        ...live,
        attendance_resolution_cutoff_at: cutoff,
      });
      await scratch.migrate((folder) => folder <= check);
      const rows =
        await client`select id,to_char(attendance_resolution_cutoff_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as cutoff from rounds where id in (${missing},${wrong},${stray})`;
      const cutoffOf = (id: string) =>
        rows.find((row: { id: string }) => row.id === id)?.cutoff;
      assert({
        given: 'rows the old schema allowed, each breaking the new rule',
        should:
          'repair every one from its final speech, so the constraint cannot refuse the deploy',
        actual: [cutoffOf(missing), cutoffOf(wrong), cutoffOf(stray)],
        expected: [cutoff.toISOString(), cutoff.toISOString(), null],
      });
      const update = (set: string, id: string) =>
        rejectedBy(() =>
          client.unsafe(`update rounds set ${set} where id='${id}'`),
        );
      assert({
        given: 'a played Round whose cutoff is cleared',
        should: 'refuse it',
        actual: await update('attendance_resolution_cutoff_at=null', missing),
        expected: 'rounds_attendance_cutoff_check',
      });
      assert({
        given:
          'a played Round whose cutoff is not its final end plus the policy',
        should: 'refuse it',
        actual: await update(
          "attendance_resolution_cutoff_at=final_segment_ended_at+interval '1 minute'",
          missing,
        ),
        expected: 'rounds_attendance_cutoff_check',
      });
      assert({
        given: 'a Round still speaking that holds a cutoff',
        should: 'refuse it',
        actual: await update(
          'attendance_resolution_cutoff_at=clock_timestamp()',
          stray,
        ),
        expected: 'rounds_attendance_cutoff_check',
      });
      assert({
        given: 'a final end written without its cutoff',
        should: 'refuse it',
        actual: await update(
          `final_segment_ended_at='${finalEnd}',transcript_admission_cutoff='${admission.toISOString()}'`,
          stray,
        ),
        expected: 'rounds_attendance_cutoff_check',
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
