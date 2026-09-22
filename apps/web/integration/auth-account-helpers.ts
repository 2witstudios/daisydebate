import { createId } from '@paralleldrive/cuid2';
import { createFlows } from './auth-mounted-flows';
import { cookieHeader, jsonPost, withSql } from './auth-mounted-helpers';

/**
 * Account harness for the stage-4 suites: real sign-up through the mounted
 * request and /auth/confirm routes, and the real username claim route.
 */
export async function createAccountFlows() {
  const flows = await createFlows();
  const { identify } = await import('../src/lib/identity');
  const usernameRoute = await import('../src/app/api/account/username/route');

  /** A brand-new account signed in through the real request → confirm path. */
  const signUp = async () => {
    const { email, token } = await flows.startSignup();
    const response = await flows.redeem(token, {
      newUserCallbackURL: '/onboarding/username?next=%2Flobby',
    });
    return { email, token, response, cookie: cookieHeader(response) };
  };

  const claim = (
    cookie: string | null,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    usernameRoute.POST(
      jsonPost('/api/account/username', body, {
        ...(cookie ? { cookie } : {}),
        ...headers,
      }),
    );

  return { flows, identify, signUp, claim };
}

export const uniqueName = () => `u${createId().slice(0, 14)}`;

export const usernameOf = (email: string) =>
  withSql(
    async (sql) =>
      (
        (await sql`SELECT username FROM users WHERE email = ${email}`)[0] as
          { username: string | null } | undefined
      )?.username ?? null,
  );

export const sessionCount = async (email: string) =>
  (
    await withSql(
      (sql) =>
        sql`SELECT count(*)::int AS c FROM session s JOIN users u ON u.id = s.user_id WHERE u.email = ${email}`,
    )
  )[0]?.c as number;
