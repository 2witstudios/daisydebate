import { drizzle } from 'drizzle-orm/bun-sql';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withFixture, sqlStateOf } from './constraint-helpers';
import { missing } from '../src/transcription-recovery/missing';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('web runs the actual finite enrollment scan under exact column grants while worker and singleton mutation stay forbidden', async () => {
  await withFixture(databaseUrl, async (f) => {
    await f.sql`update transcription_recovery_enrollment_progress set after_at=null,after_round_id=null,until_at=null,until_round_id=null,next_scan_at=clock_timestamp()-interval '1 millisecond' where singleton`;
    const before =
      await f.sql`select next_scan_at from transcription_recovery_enrollment_progress where singleton`;
    const found = await f.sql.begin(async (client) => {
      await client`set local role daisy_web`;
      return missing(drizzle({ client }));
    });
    const [after] =
      await f.sql`select next_scan_at>${before[0]!.next_scan_at} as advanced,after_at is null and after_round_id is null and until_at is null and until_round_id is null as cleared from transcription_recovery_enrollment_progress where singleton`;
    const denied = [];
    for (const [role, statement] of [
      [
        'daisy_web',
        'update transcription_recovery_enrollment_progress set singleton=true',
      ],
      ['daisy_web', 'delete from transcription_recovery_enrollment_progress'],
      [
        'daisy_web',
        'insert into transcription_recovery_enrollment_progress(singleton) values(false)',
      ],
      [
        'daisy_media_worker',
        'select * from transcription_recovery_enrollment_progress',
      ],
      [
        'daisy_web',
        'update transcription_recovery_enrollment_offers set evidence_id=evidence_id',
      ],
      ['daisy_web', 'delete from transcription_recovery_enrollment_offers'],
      [
        'daisy_media_worker',
        'select * from transcription_recovery_enrollment_offers',
      ],
      [
        'daisy_media_worker',
        'update transcription_recovery_enrollment_progress set next_scan_at=clock_timestamp()',
      ],
    ] as const) {
      denied.push(
        await sqlStateOf(() =>
          f.sql.begin(async (client) => {
            await client.unsafe(`set local role ${role}`);
            return client.unsafe(statement);
          }),
        ),
      );
    }
    assert({
      given:
        'real migration grants, an empty eligible backlog and the actual scan operation under SET LOCAL ROLE daisy_web',
      should:
        'serialize/update only private scan position and pacing, preserving immutable singleton and no worker discovery or DML',
      actual: { found, after, denied },
      expected: {
        found: [],
        after: { advanced: true, cleared: true },
        denied: Array(8).fill('42501'),
      },
    });
  });
});
