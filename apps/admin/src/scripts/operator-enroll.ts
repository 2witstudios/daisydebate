import { systemClock, systemId } from '@daisy/clock';
import { issueEnrollment } from '../auth/issue-enrollment';
import { systemRandom } from '../auth/secrets';
import { readAdminConfig } from '../config';
import { openAdminDatabase } from '../db/client';
import { parseEnrollArgs } from './enroll-args';

/**
 * `bun apps/admin/src/scripts/operator-enroll.ts --name <n> [--replace|--additional]`
 * over `fly ssh console`: prints the one-time enrollment URL to open through
 * `fly proxy 4800:8080` (docs/operations/deploy-staging.md §12).
 */
const args = parseEnrollArgs(process.argv.slice(2));
if (!args.ok) {
  process.stderr.write(`${args.reason}\n`);
  process.exit(2);
}
const config = readAdminConfig(process.env);
const database = openAdminDatabase(config.ADMIN_DATABASE_URL, { max: 1 });
try {
  const result = await issueEnrollment(
    {
      db: database.db,
      clock: systemClock,
      ids: systemId,
      random: systemRandom,
    },
    args,
  );
  if (result.ok)
    process.stdout.write(
      `Open within 15 minutes, through fly proxy 4800:8080:\n${result.url}\n`,
    );
  else process.stderr.write(`${result.reason}\n`);
  process.exitCode = result.ok ? 0 : 1;
} finally {
  await database.close();
}
