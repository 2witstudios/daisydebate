import { createId } from '@paralleldrive/cuid2';
import { approveBetaAccess } from '@daisy/db/testing';
import type { Identity } from '@daisy/auth';
import { createFlows } from './auth-mounted-flows';
import { cookieHeader, withSql, type TestApp } from './fixtures';
import { CLIENT_IP_HEADER } from '@daisy/ingress/client-ip';
import { CONFIRM_PATH } from '../src/features/auth/confirmation/confirm-page';
import { identify, resolveSession } from '../src/lib/identity';

/**
 * A replayed, invalid or otherwise redeemed emailed-link token maps to a
 * 303 back to the confirm page with `?error=INVALID_TOKEN` and no cookie,
 * never the success redirect (`confirm.ts`).
 */
export const emailedLinkRejected = (response: Response): boolean => {
  const location = response.headers.get('location') ?? '';
  return (
    response.status === 303 &&
    location.startsWith(CONFIRM_PATH) &&
    location.includes('error=INVALID_TOKEN') &&
    response.headers.getSetCookie().length === 0
  );
};

type JsonPost = (
  path: string,
  body: unknown,
  headers?: Record<string, string>,
) => Request;

/**
 * Answers the real age step as an adult who accepts the Terms: every
 * sign-up passes it before its username claim (WAIT-4.6).
 */
export async function answerAdultAge(
  ageRoute: { POST: (request: Request) => Promise<Response> },
  jsonPost: JsonPost,
  cookie: string,
): Promise<void> {
  const answered = await ageRoute.POST(
    jsonPost(
      '/api/account/age',
      { month: 1, year: 1990, terms: true },
      {
        cookie,
      },
    ),
  );
  if (!answered.ok) throw new Error('Fixture age step failed');
}

/**
 * Account harness for the stage-4 suites: real sign-up through the mounted
 * request and /auth/confirm routes, and the real username claim route, all
 * on the suite's own app.
 */
export function createAccountFlows(testApp?: TestApp) {
  const flows = createFlows(testApp);
  const { app, jsonPost, newClient } = flows;
  /** A server-side session read as a page render makes it for one client. */
  const identifyAs = (cookie: string, client = newClient()) =>
    identify(app.auth(), new Headers({ cookie, [CLIENT_IP_HEADER]: client }));
  const { username: usernameRoute, age: ageRoute } = flows.testApp.routes;

  /**
   * A brand-new account signed in through the real request → confirm path,
   * past the age step as every sign-up must be before its username claim.
   */
  const signUp = async () => {
    const { email, token } = await flows.startSignup();
    const response = await flows.redeem(token, {
      newUserCallbackURL: '/onboarding/age?next=%2Flobby',
    });
    const cookie = cookieHeader(response);
    await answerAdultAge(ageRoute, jsonPost, cookie);
    return { email, token, response, cookie };
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

  /**
   * The claim, then the operator's approval (ADR 0075): for suites that need
   * a member rather than an account waiting on the beta list.
   */
  const claimMember = async (cookie: string, body: unknown) => {
    const response = await claim(cookie, body);
    if (response.status === 201) {
      const userId = identityUserId(await identifyAs(cookie));
      if (userId) await withSql((sql) => approveBetaAccess(sql, userId));
    }
    return response;
  };

  const sessionAs = (cookie: string) =>
    resolveSession(
      app.auth(),
      new Headers({ cookie, [CLIENT_IP_HEADER]: newClient() }),
    );

  return { flows, identifyAs, sessionAs, signUp, claim, claimMember };
}

/** The user id behind a signed-in identity, or null for anyone else. */
export const identityUserId = (identity: Identity): string | null =>
  identity.state === 'member' ||
  identity.state === 'waitlisted' ||
  identity.state === 'provisional'
    ? identity.principal.userId
    : null;

/**
 * Approves the account behind `email` for the beta (ADR 0075), as an
 * operator would, so a suite that needs a member gets one after its claim.
 */
export const approveByEmail = (email: string) =>
  withSql(async (sql) => {
    const [row] = (await sql`SELECT id FROM users WHERE email = ${email}`) as {
      id: string;
    }[];
    if (!row) throw new Error('No account for that address');
    await approveBetaAccess(sql, row.id);
  });

export const uniqueName = () => `u${createId().slice(0, 14)}`;

export const usernameOf = (email: string) =>
  withSql(
    async (sql) =>
      (
        (await sql`SELECT username FROM users WHERE email = ${email}`)[0] as
          { username: string | null } | undefined
      )?.username ?? null,
  );
