import { SQL } from 'bun';

/**
 * Fixture-only write for the Node-driven proof: beta approval always writes
 * the casual AI judge grant, and only a future billing lapse removes it, so
 * its own slot withdraws one member's grant directly.
 */
if (import.meta.main) {
  const target = process.env.E2E_DATABASE_URL!;
  if (!new URL(target).pathname.endsWith('_e2e'))
    throw new Error('This write runs only against an E2E database');
  const username = Bun.argv[2]!;
  const sql = new SQL(target, { max: 1 });
  try {
    await sql`delete from account_entitlement_grants
      where entitlement = 'casual_ai_judge'
        and user_id = (select id from users where username = ${username})`;
  } finally {
    await sql.close();
  }
}
