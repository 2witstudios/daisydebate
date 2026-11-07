import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createTestApp,
  withSql,
  testDatabaseUrl,
  removeAccount,
} from './fixtures';
import { createAccountFlows } from './auth-account-helpers';
import { createStagingAttendanceMember } from '../scripts/staging-attendance-member';
setupRitewayBun();

test('staging repair convention creates a genuine admitted age-qualified signed session', async () => {
  const app = createTestApp({ PUBLIC_APP_URL: 'https://daisy.test' });
  const account = createAccountFlows(app);
  await withSql(async (sql) => {
    const member = await createStagingAttendanceMember({
      sql,
      url: testDatabaseUrl,
      secret: app.env.BETTER_AUTH_SECRET!,
    });
    try {
      const identity = await account.identifyAs(member.cookie);
      const [facts] =
        await sql`select b.state,a.birth_month,(s.expires_at>now()+interval '6 days') as durable from account_beta_access b join account_age a on a.user_id=b.user_id join session s on s.user_id=b.user_id where b.user_id=${member.userId} and s.id=${member.sessionId}`;
      assert({
        given:
          'the actual synthetic account provisioner and mounted identity/session path',
        should:
          'admit the real signed account with durable age and ordinary seven-day session',
        actual: [identity.state, facts],
        expected: [
          'member',
          { state: 'approved', birth_month: '1990-01', durable: true },
        ],
      });
      const refused = await account.identifyAs(member.cookie + 'tampered');
      assert({
        given: 'the same account with a tampered cookie',
        should: 'remain subject to normal signature authority',
        actual: refused.state === 'member',
        expected: false,
      });
    } finally {
      await removeAccount({ userId: member.userId });
    }
  });
});
