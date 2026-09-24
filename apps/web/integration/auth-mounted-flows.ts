import {
  cookieHeader,
  createTestApp,
  linkFrom,
  tokenOf,
  withSql,
} from './fixtures';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

/**
 * Mounted-route flow harness: the REAL `/api/auth` and `/auth/confirm` route
 * handlers of this suite's own app over real PostgreSQL/Redis with only the
 * mail transport captured.
 * Its app removes the accounts it created after the suite.
 */
export function createFlows() {
  const testApp = createTestApp();
  const {
    routes,
    mailbox,
    jsonPost,
    formPost,
    newClient,
    freshEmail: fresh,
    trackAccount: track,
  } = testApp;
  const authRoute = routes.auth;
  const confirmRoute = routes.confirm;
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
  /** A fresh magic-link token for an address, as its mail carries it. */
  const linkTokenFor = async (email: string) =>
    tokenOf((await requestLink(email)).link as URL);
  /** A second real session for an address: a new link, redeemed. */
  const signInAgain = async (email: string) =>
    cookieHeader(await redeem(await linkTokenFor(email)));
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
    track,
    requestLink,
    linkTokenFor,
    signInAgain,
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
