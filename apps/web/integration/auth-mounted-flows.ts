import { afterAll } from 'bun:test';
import {
  cookieHeader,
  createTestApp,
  fixtureEmail,
  linkFrom,
  removeAccount,
  withSql,
} from './auth-mounted-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

/**
 * Mounted-route flow harness: the REAL `/api/auth` and `/auth/confirm` route
 * handlers of this suite's own app over real PostgreSQL/Redis with only the
 * mail transport captured. Registers its own cleanup for the accounts it
 * created.
 */
export function createFlows() {
  const testApp = createTestApp();
  const { routes, mailbox, jsonPost, formPost, newClient } = testApp;
  const authRoute = routes.auth;
  const confirmRoute = routes.confirm;
  const emails: string[] = [];
  const fresh = () => {
    const email = fixtureEmail();
    emails.push(email);
    return email;
  };
  afterAll(async () => {
    for (const email of emails) await removeAccount(email);
  });
  const requestLink = async (
    email: string,
    body: Record<string, unknown> = {},
  ) => {
    const before = mailbox.mails.length;
    const response = await authRoute.POST(
      jsonPost('/api/auth/sign-in/magic-link', { email, ...body }),
    );
    const mail = mailbox.mails[before];
    return { response, mail, link: mail ? linkFrom(mail) : undefined };
  };
  const confirmGet = (link: URL, method: 'GET' | 'HEAD' = 'GET') =>
    confirmRoute[method](
      new Request(link, {
        method,
        headers: { [CLIENT_IP_HEADER]: newClient() },
      }),
    );
  const redeem = (token: string, extra: Record<string, string> = {}) =>
    confirmRoute.POST(formPost({ token, callbackURL: '/lobby', ...extra }));
  /** A new address with a requested link and its token. */
  const startSignup = async () => {
    const email = fresh();
    const requested = await requestLink(email);
    const link = requested.link as URL;
    return { email, ...requested, link, token: tokenOf(link) };
  };
  const session = (response: Response) =>
    authRoute.GET(
      new Request(`${testApp.origin}/api/auth/get-session`, {
        headers: {
          cookie: cookieHeader(response),
          [CLIENT_IP_HEADER]: newClient(),
        },
      }),
    );
  return {
    testApp,
    app: testApp.app,
    mailbox,
    authRoute,
    confirmRoute,
    newClient,
    jsonPost,
    formPost,
    fresh,
    requestLink,
    confirmGet,
    redeem,
    startSignup,
    session,
    userRows: (email: string) =>
      withSql(
        (sql) =>
          sql`SELECT id, email, email_verified FROM users WHERE email = ${email}`,
      ),
  };
}

export const tokenOf = (link: URL) => link.searchParams.get('token') ?? '';
