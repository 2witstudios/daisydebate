import { assert, test } from 'riteway/bun';
import { rejectedBy, withFixture } from './constraint-helpers';
import { integrationSuite } from './suite.test-support';

const { databaseUrl } = integrationSuite();
const check = 'account_entitlement_grants_entitlement_check';

test('the entitlement check admits the casual AI judge kind and refuses an unknown one (WATCH-16)', async () => {
  await withFixture(databaseUrl, async (f) => {
    const userId = await f.user();
    const grant = (entitlement: string) =>
      f.sql`insert into account_entitlement_grants (user_id, entitlement, source)
        values (${userId}, ${entitlement}, 'beta')`;
    assert({
      given: 'a beta grant of the casual AI judge, then of an unknown kind',
      should: 'admit the first and refuse the second by the entitlement check',
      actual: [
        await rejectedBy(() => grant('casual_ai_judge')),
        await rejectedBy(() => grant('unknown_premium')),
      ],
      expected: [null, check],
    });
  });
});
