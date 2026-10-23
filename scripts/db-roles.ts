/**
 * `bun db:roles`: provisions the test logins on the migrated local or CI
 * cluster DATABASE_URL names, through the same `provisionTestRoles` that
 * `bun slot:up` and `bun db:reset` call (ISSUE-6: one place). Loopback only.
 */
import { SQL } from 'bun';
import { provisionTestRoles } from '@daisy/db/slots';
import { isLoopbackUrl } from './slot-services';
import { testLogins } from './test-logins';

const url = process.env.DATABASE_URL;
if (!url || !isLoopbackUrl(url))
  throw new Error('DATABASE_URL must name a loopback server');
const admin = new SQL(url, { max: 1 });
try {
  await provisionTestRoles(admin, testLogins);
} finally {
  await admin.close();
}
process.stdout.write(
  testLogins
    .map(
      (login) => `Provisioned ${login.user} as a member of ${login.memberOf}\n`,
    )
    .join(''),
);
