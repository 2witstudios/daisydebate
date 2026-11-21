/**
 * The route patterns a log line may name (ISSUE-832, ADR 0087). A concrete
 * URL is never one of them, so no username or id rides a `route` or `path`
 * field. The logger and the log shipper read this one list, so they cannot
 * drift. The App Router patterns are generated (`bun log:routes`) in the form
 * Next reports them (`/profile/[username]`); `scripts/log-routes.test.ts` fails
 * while that file is stale, and `apps/web` proves every configured Better Auth
 * endpoint is listed.
 */
import { appRoutes } from './app-routes.generated';

/** Better Auth's endpoint paths, which it reports as patterns. */
const betterAuthRoutes = [
  '/account-info',
  '/callback/:id',
  '/change-email',
  '/change-password',
  '/delete-user',
  '/delete-user/callback',
  '/email-change/verify',
  '/error',
  '/get-access-token',
  '/get-session',
  '/link-social',
  '/list-accounts',
  '/list-sessions',
  '/magic-link/verify',
  '/ok',
  '/passkey/delete-passkey',
  '/passkey/generate-authenticate-options',
  '/passkey/generate-register-options',
  '/passkey/list-user-passkeys',
  '/passkey/update-passkey',
  '/passkey/verify-authentication',
  '/passkey/verify-registration',
  '/refresh-token',
  '/request-password-reset',
  '/reset-password',
  '/reset-password/:token',
  '/revoke-other-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/send-verification-email',
  '/sign-in/email',
  '/sign-in/magic-link',
  '/sign-in/social',
  '/sign-out',
  '/sign-up/email',
  '/unlink-account',
  '/update-session',
  '/update-user',
  '/verify-email',
  '/verify-password',
];

/** Patterns a call site names literally. */
const namedRoutes = ['/api/rounds/:id/media/reconcile'];

export const logRoutes: ReadonlySet<string> = new Set([
  ...betterAuthRoutes,
  ...appRoutes,
  ...namedRoutes,
]);
