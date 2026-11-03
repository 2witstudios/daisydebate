import { SQL } from 'bun';
import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { rejectedBy } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const migration = '20261103092658_nebulous_living_mummy';
const check = 'account_entitlement_grants_entitlement_check';
const scratch = scratchDatabase(url, 'casualaijudge');

afterAll(() => scratch.drop());

test(
  'the migration admits the casual AI judge kind and grants it to every approved account, and nobody else (WATCH-16)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    const sql = new SQL(scratch.url, { max: 1 });
    try {
      const account = async (state: 'pending' | 'approved' | 'revoked') => {
        const userId = createId();
        await sql`insert into users (id, username, email_verified)
          values (${userId}, ${`u-${userId}`}, true)`;
        await sql`insert into account_beta_access (user_id, state, requested_at, decided_at, provenance)
          values (${userId}, ${state}, now(),
            ${state === 'pending' ? null : new Date()}, 'signup')`;
        return userId;
      };
      const grant = (userId: string, entitlement: string) =>
        sql`insert into account_entitlement_grants (user_id, entitlement, source)
          values (${userId}, ${entitlement}, 'beta')`;

      const pending = await account('pending');
      const revoked = await account('revoked');
      const approved = await account('approved');
      const alreadyPremium = await account('approved');
      await grant(approved, 'round_analysis');
      await grant(approved, 'ai_rounds');
      const before = await rejectedBy(() => grant(pending, 'casual_ai_judge'));

      await scratch.migrate((folder) => folder <= migration);

      const held = async (userId: string) =>
        (
          await sql<{ entitlement: string; source: string }[]>`
            select entitlement, source from account_entitlement_grants
             where user_id = ${userId} order by entitlement`
        ).map((row) => [row.entitlement, row.source]);
      assert({
        given: 'the schema before the migration',
        should: 'refuse the kind by the entitlement check',
        actual: before,
        expected: check,
      });
      assert({
        given: 'approved accounts with and without other grants',
        should: 'add both beta grants to each and keep what they held',
        actual: [await held(approved), await held(alreadyPremium)],
        expected: [
          [
            ['ai_rounds', 'beta'],
            ['casual_ai_judge', 'beta'],
            ['casual_capture', 'beta'],
            ['round_analysis', 'beta'],
          ],
          [
            ['casual_ai_judge', 'beta'],
            ['casual_capture', 'beta'],
          ],
        ],
      });
      assert({
        given: 'pending and revoked accounts',
        should: 'grant nothing',
        actual: [await held(pending), await held(revoked)],
        expected: [[], []],
      });
      assert({
        given: 'the migrated check',
        should:
          'admit the new kind for a later approval and still refuse an unknown one',
        actual: [
          await rejectedBy(() => grant(revoked, 'casual_ai_judge')),
          await rejectedBy(() => grant(revoked, 'unknown_premium')),
        ],
        expected: [null, check],
      });
    } finally {
      await sql.close();
    }
  },
  ddlTimeoutMs * 3,
);
