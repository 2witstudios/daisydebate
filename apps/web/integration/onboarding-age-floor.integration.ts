import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { systemClock } from '@daisy/clock';
import { requireTestServices } from '@daisy/config';
import { createAccountFlows, uniqueName } from './auth-account-helpers';
import { cookieHeader, withSql } from './fixtures';
import { ageComposition } from '../src/features/account/composition';

requireTestServices(process.env);
setupRitewayBun();
const { flows, identifyAs, claim } = createAccountFlows();
const { jsonPost } = flows;
const age = flows.testApp.routes(ageComposition);

/** The birth month and year that many whole months before now, in UTC. */
const monthsAgo = (months: number) => {
  const now = new Date(systemClock.now());
  const index = now.getUTCFullYear() * 12 + now.getUTCMonth() - months;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

/** A new account through the real sign-up, stopped before its age step. */
const signUpBeforeAge = async () => {
  const { email, token } = await flows.startSignup();
  const response = await flows.redeem(token, {
    newUserCallbackURL: '/onboarding/age?next=%2Flobby',
  });
  return { email, cookie: cookieHeader(response) };
};

const accountOf = (email: string) =>
  withSql(async (sql) => {
    const [row] = (await sql`
      select u.id, a.birth_month
        from users u left join account_age a on a.user_id = u.id
       where u.email = ${email}`) as {
      id: string;
      birth_month: string | null;
    }[];
    return row ?? null;
  });

describe('sign-up at the member floor of 13 (YLS-8, decision 88)', () => {
  test('a 12-year-old is refused and kept nowhere; 13, 15 and 16 become members on the Youth ladder', async () => {
    const ages = [
      ['12y11m', 13 * 12 - 1],
      ['13', 13 * 12],
      ['15', 15 * 12 + 6],
      ['16', 16 * 12],
    ] as const;
    const results = [];
    for (const [label, months] of ages) {
      const { email, cookie } = await signUpBeforeAge();
      const answered = await age.POST(
        jsonPost(
          '/api/account/age',
          { ...monthsAgo(months), terms: true },
          { cookie },
        ),
      );
      const status = answered.status;
      const body = (await answered.json()) as {
        error?: { refusal?: string };
      };
      const stored = await accountOf(email);
      let identity: string | null = null;
      let division: string | null = null;
      if (status === 200) {
        const claimed = await claim(cookie, { username: uniqueName() });
        if (claimed.status !== 201) throw new Error(`claim failed: ${label}`);
        identity = (await identifyAs(cookie)).state;
        division = await flows.app.database.readMemberDivision(stored!.id);
      }
      results.push({
        label,
        status,
        refusal: body.error?.refusal ?? null,
        held: answered.headers.get('set-cookie')?.includes('under-13') ?? false,
        account: stored === null ? 'gone' : stored.birth_month !== null,
        identity,
        division,
      });
    }
    assert({
      given:
        'sign-ups answering a birth month 12 years 11 months, exactly 13, 15 and 16 years ago, then claiming a username and approval',
      should:
        'refuse and delete the 12-year-old with the under-13 hold, and admit the others as members on the Youth ladder, with no parental step',
      actual: results,
      expected: [
        {
          label: '12y11m',
          status: 403,
          refusal: 'under-13',
          held: true,
          account: 'gone',
          identity: null,
          division: null,
        },
        ...(['13', '15', '16'] as const).map((label) => ({
          label,
          status: 200,
          refusal: null,
          held: false,
          account: true,
          identity: 'member',
          division: 'youth',
        })),
      ],
    });
  });
});
