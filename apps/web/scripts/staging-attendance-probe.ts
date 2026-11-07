import { SQL } from 'bun';
import { writeFile } from 'node:fs/promises';
import { createPublicProbeRound } from '../e2e/support/launch-probe-room';
import { createStagingAttendanceMember } from './staging-attendance-member';
import { stagingAttendanceConfiguration } from './staging-attendance-target';

/** Invoked on the staging web machine via a reviewed bundle on stdin; secret output stays in a private file. */
async function main() {
  const { url, secret, origin } = stagingAttendanceConfiguration(
    process.env,
    process.argv[2],
  );
  const sql = new SQL(url, { max: 1, idleTimeout: 0 });
  let stage = 'database';
  try {
    const [db] =
      await sql`select current_database() as name,pg_try_advisory_lock(906,3) as held`;
    if (db?.name !== 'daisy_debate_staging' || !db.held)
      throw new Error('Staging attendance database or repair lock mismatch');
    stage = 'members';
    const members = [];
    for (let index = 0; index < 3; index++)
      members.push(
        await createStagingAttendanceMember({
          sql,
          url,
          secret,
        }),
      );
    stage = 'public-round';
    const fixture = await createPublicProbeRound(origin, members);
    stage = 'durable-proof';
    const [proof] =
      await sql`select r.status, count(distinct c.participant_id)::int as attended from rounds r join round_check_ins c on c.round_id=r.id where r.id=${fixture.roundId} group by r.status`;
    if (proof?.status !== 'active' || proof.attended !== 2)
      throw new Error('Synthetic durable receipt proof failed');
    stage = 'private-file';
    const file = `/tmp/attendance-probe-${fixture.roundId}.env`;
    await writeFile(
      file,
      `ATTENDANCE_PUBLIC_PROBE='${JSON.stringify(fixture)}'\n`,
      { mode: 0o600, flag: 'wx' },
    );
    // Only the negative speaker's durable session is needed by the deployed probe.
    for (const member of [members[0]!, members[2]!])
      await sql`delete from session where id=${member.sessionId} and user_id=${member.userId}`;
    process.stdout.write(
      JSON.stringify({
        phase: 'staging-fixture-created',
        file,
        active: true,
        genuineReceipts: true,
        schema: 'ids-cookie-only',
        roundId: fixture.roundId,
      }) + '\n',
    );
  } catch {
    throw new Error(`Staging attendance repair failed at ${stage}`);
  } finally {
    await sql.close();
  }
}
await main();
