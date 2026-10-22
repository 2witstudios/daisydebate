import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectedBy, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('actual final close pins one immutable 120-second transcript admission cutoff', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round({
      status: 'active',
      current_stage: 'live',
      started_at: new Date('2026-10-22T05:00:00Z'),
    });
    await fixture.sql.unsafe(
      "update rounds set final_segment_ended_at='2026-10-22T05:01:00Z', transcript_admission_cutoff='2026-10-22T05:03:00Z' where id=$1",
      [roundId],
    );
    const immutable = await rejectedBy(() =>
      fixture.sql.unsafe(
        "update rounds set final_segment_ended_at='2026-10-22T05:02:00Z', transcript_admission_cutoff='2026-10-22T05:04:00Z' where id=$1",
        [roundId],
      ),
    );
    const cleared = await rejectedBy(() =>
      fixture.sql.unsafe(
        'update rounds set final_segment_ended_at=null, transcript_admission_cutoff=null where id=$1',
        [roundId],
      ),
    );
    const otherRoundId = await fixture.round();
    const mismatched = await rejectedBy(() =>
      fixture.sql.unsafe(
        "update rounds set final_segment_ended_at='2026-10-22T05:01:00Z', transcript_admission_cutoff='2026-10-22T05:04:00Z' where id=$1",
        [otherRoundId],
      ),
    );
    assert({
      given: 'one committed actual final end anchor',
      should:
        'reject changes, clearing and a cutoff other than exactly 120 seconds later',
      actual: { immutable, cleared, mismatched },
      expected: {
        immutable: 'rounds_final_segment_end_immutable',
        cleared: 'rounds_final_segment_end_immutable',
        mismatched: 'rounds_transcript_cutoff_check',
      },
    });
  });
});
