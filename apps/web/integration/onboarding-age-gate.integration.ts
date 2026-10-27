import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { topicChoices } from '@daisy/protocol';
import { createAccountFlows, uniqueName } from './auth-account-helpers';
import { withSql } from './fixtures';

requireTestServices(process.env);
setupRitewayBun();
const { flows, signUp, claim } = createAccountFlows();
const { jsonPost } = flows;
const { onboarding } = flows.testApp.routes;

const topicsOf = (email: string) =>
  withSql(
    async (sql) =>
      (
        await sql`select count(*)::int as n from member_topics t join users u on u.id = t.user_id where u.email = ${email}`
      )[0].n as number,
  );

describe('optional onboarding answers through the composed routes (ISSUE-678)', () => {
  test('the real routes.ts wiring admits a 16+ member and refuses one without a canonical age', async () => {
    const save = (cookie: string) =>
      onboarding.POST(
        jsonPost(
          '/api/account/onboarding',
          { step: 'topics', topics: [topicChoices[0]] },
          { cookie },
        ),
      );
    const adult = await signUp();
    const unknown = await signUp();
    for (const { cookie } of [adult, unknown])
      await claim(cookie, { username: uniqueName() });
    // No canonical age fact: the composed admits must refuse it.
    await withSql(
      (sql) =>
        sql`delete from account_age where user_id = (select id from users where email = ${unknown.email})`,
    );
    const admitted = await save(adult.cookie);
    const refused = await save(unknown.cookie);
    assert({
      given:
        'two members posting a topics step, one 16+ and one whose age fact is gone',
      should:
        'store the adult’s answer and refuse the other with 403, storing nothing',
      actual: [
        admitted.status,
        await topicsOf(adult.email),
        refused.status,
        await topicsOf(unknown.email),
      ],
      expected: [200, 1, 403, 0],
    });
  });
});
