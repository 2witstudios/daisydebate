import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { createAppError } from '@daisy/errors';
import type { Clock, IdGenerator } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import type { AuthConfig } from '@daisy/config';
import type {
  AuthEmailMessage,
  AuthEmailSender,
  AuthDeliveryLedger,
} from './mail-types';
import { buildConfirmLink } from './confirm-link';
import {
  emailedLinkIdentifier,
  generateEmailedLinkToken,
} from './emailed-link-token';
import { emailChangePlugin } from './email-change';
import { createMagicLinkGatePlugin } from './magic-link-gate';
import { freshSessionGatePlugin } from './fresh-session-gate';
import { browserSessionShapePlugin } from './browser-session-shape';
import { passkeyDeviceHintPlugin } from './passkey-device-hint';
import { passkeyNotificationsPlugin } from './passkey-notifications';
import { sessionRevokedOutboxPlugin } from './session-revoked-outbox';
import { revokeOthersOnEmailChangePlugin } from './revoke-others-on-email-change';
import { deriveRecipientSubkey, recipientKey } from './recipient-key';
import { renderAuthEmail } from './mail/templates';
import { sendOrUnavailable } from './deliver-or-unavailable';
import {
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_FRESH_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from './session-policy';
import { CLIENT_IP_HEADER } from './client-ip';
import {
  clientIpOptions,
  createRateLimitGate,
  type AuthRateLimiter,
} from './rate-limit';

const MAGIC_LINK_EXPIRES_IN_SECONDS = 300;

/** ISSUE-3 AC3: the atomic revoke `revokeOthersOnEmailChangePlugin` runs. */
type RevokeOtherSessions = (
  userId: string,
  keepToken: string,
) => Promise<number>;

/** Application-level email contract; the Resend transport plugs in here. */
export type {
  AuthEmailMessage,
  AuthEmailSender,
  AuthDeliveryLedger,
} from './mail-types';
/** Composition without a ledger neither suppresses nor records receipts. */
const noLedger: AuthDeliveryLedger = {
  isSuppressed: async () => false,
  record: async () => {},
};

/**
 * The composed Better Auth instance with the passwordless plugins applied.
 * Created lazily by the factory; importing this module performs no I/O.
 */
type AuthInstance = ReturnType<typeof composeBetterAuth>;

const composeBetterAuth = (dependencies: {
  readonly config: AuthConfig;
  readonly recipientSubkey: string;
  readonly database: BetterAuthOptions['database'];
  readonly deliver: (message: AuthEmailMessage) => Promise<void>;
  readonly limiter: AuthRateLimiter;
  readonly ledger: AuthDeliveryLedger;
  readonly logger: Logger;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly appendSessionRevoked: (userId: string) => Promise<void>;
  readonly revokeOtherSessions: RevokeOtherSessions;
}) => {
  const { config, ledger, recipientSubkey } = dependencies;
  const origin = new URL(config.PUBLIC_APP_URL).origin;
  const magicLinkGatePlugin = createMagicLinkGatePlugin({
    recipientSubkey,
    ledger,
  });
  const instance = betterAuth({
    baseURL: config.PUBLIC_APP_URL,
    trustedOrigins: [origin],
    secret: config.BETTER_AUTH_SECRET,
    database: dependencies.database,
    // Better Auth's default logger prints driver errors verbatim, including
    // SQL text and bound parameters (magic-link tokens, emails). Report only
    // the severity through the application logger.
    logger: {
      log: (level) => {
        if (level === 'error' || level === 'warn')
          dependencies.logger.log(
            'request.unhandled',
            { source: 'better-auth', sourceLevel: level },
            'Authentication library reported a failure',
          );
      },
    },
    // better-call prints unhandled errors with console.error, exposing SQL and
    // parameters; rethrow so the guarded handler below reports them safely.
    onAPIError: { throw: true },
    advanced: {
      database: {
        // Entity identifiers come from the injected generator (cuid2 at
        // the production edge, ADR 0018), never an ambient one.
        generateId: () => dependencies.ids.next(),
      },
      // Trust exactly the one header the ingress stamps; see rate-limit.ts.
      ipAddress: clientIpOptions(CLIENT_IP_HEADER),
    },
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      freshAge: SESSION_FRESH_AGE_SECONDS,
      // Revocation must be visible on the next server check.
      cookieCache: { enabled: false },
    },
    // The injected atomic limiter is the only rate limit. Better Auth's
    // built-in limiter never sees direct `auth.api` calls and cannot fail
    // closed with a 503, so the gate below replaces it.
    rateLimit: { enabled: false },
    hooks: {
      before: createRateLimitGate({
        limiter: dependencies.limiter,
        logger: dependencies.logger,
        recipientSubkey,
      }),
    },
    emailAndPassword: { enabled: false },
    // Belt and braces: password/reset/delete surfaces answer 404 outright.
    disabledPaths: [
      '/sign-up/email',
      '/sign-in/email',
      '/forget-password',
      '/request-password-reset',
      '/reset-password',
      '/change-password',
      '/set-password',
      '/delete-user',
      '/delete-user/callback',
      // Onboarding is server-owned: the profile has no general update
      // surface, so the username is set only by POST /api/account/username.
      '/update-user',
      // Every row carries its bearer token and client IP; the account UI
      // lists through GET /api/account/sessions, and the server still calls
      // auth.api.listSessions (disabledPaths gates HTTP only).
      '/list-sessions',
      // ISSUE-2: Better Auth's email verification mints signed JWT links;
      // the email change runs on opaque stored tokens (`email-change.ts`).
      '/verify-email',
      '/send-verification-email',
    ],
    user: {
      additionalFields: {
        // Readable on the session; `input: false` refuses any client value.
        username: { type: 'string', required: false, input: false },
      },
    },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
        // ISSUE-2: the emailed-link model — an opaque 256-bit CSPRNG token,
        // stored only as its purpose-scoped SHA3-256 digest (Better Auth's
        // `'hashed'` option is SHA-256).
        generateToken: () => generateEmailedLinkToken(),
        storeToken: {
          type: 'custom-hasher',
          hash: async (token) => emailedLinkIdentifier('sign-in', token),
        },
        sendMagicLink: async ({ email, url }) => {
          const href = buildConfirmLink(origin, url).toString();
          const message = renderAuthEmail({ kind: 'sign-in', url: href });
          await sendOrUnavailable(dependencies.deliver, {
            to: email,
            ...message,
          });
        },
      }),
      passkey({
        rpID: new URL(config.PUBLIC_APP_URL).hostname,
        rpName: 'Daisy',
        origin,
        // Discoverable, so username-less and autofill sign-in can find it;
        // no attachment, so platform and roaming authenticators both enroll.
        // The device-first preference is `passkeyDeviceHintPlugin`'s hint.
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'preferred',
        },
      }),
      passkeyDeviceHintPlugin,
      passkeyNotificationsPlugin(
        origin,
        dependencies.deliver,
        dependencies.logger,
      ),
      magicLinkGatePlugin,
      emailChangePlugin({
        origin,
        deliver: dependencies.deliver,
        clock: dependencies.clock,
      }),
      freshSessionGatePlugin,
      sessionRevokedOutboxPlugin(
        dependencies.appendSessionRevoked,
        dependencies.logger,
      ),
      revokeOthersOnEmailChangePlugin(
        dependencies.revokeOtherSessions,
        dependencies.logger,
      ),
      // Last: strips the session token and ipAddress from every HTTP
      // response after the plugins above have read the full result.
      browserSessionShapePlugin,
    ],
  });
  return {
    ...instance,
    handler: async (request: Request): Promise<Response> => {
      try {
        return await instance.handler(request);
      } catch (error) {
        dependencies.logger.log(
          'request.unhandled',
          { source: 'better-auth' },
          'Authentication request failed',
        );
        // A retryable outage, typed at the source, so callers (the mounted
        // route wrapper, the confirm-page internal forward) read the error
        // code rather than the response.
        throw createAppError('INFRASTRUCTURE', undefined, error);
      }
    },
  };
};

/**
 * Only what production callers read off the result: the app's routes and
 * pages (`server/app.ts` composes it) use `config`, `instance`, `limiter`,
 * `clock` and `logger`. Mail delivery, `database`, `ledger` and `ids` stay
 * internal to composition; tests reach delivery through a real auth
 * request.
 */
export type AuthServer = {
  readonly config: AuthConfig;
  readonly instance: AuthInstance;
  readonly limiter: AuthRateLimiter;
  readonly logger: Logger;
  readonly clock: Clock;
};

/**
 * Auth factory: composes the injected, already-validated configuration and
 * dependencies; it performs no I/O and dials no service. Importing
 * this module requires no credentials and contacts nothing.
 */
export function createAuthServer<
  Database extends BetterAuthOptions['database'],
>(dependencies: {
  /** Validated by the composition root (`readAuthConfig`). */
  readonly config: AuthConfig;
  readonly database: Database;
  readonly emailSender: AuthEmailSender;
  readonly limiter: AuthRateLimiter;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Mail receipts and suppressions (production supplies the @daisy/db one). */
  readonly ledger?: AuthDeliveryLedger | undefined;
  /** RT-2.2: appends `session.revoked` after a confirmed self-service revoke. */
  readonly appendSessionRevoked: (userId: string) => Promise<void>;
  readonly revokeOtherSessions: RevokeOtherSessions;
}): AuthServer {
  const { config } = dependencies;
  const recipientSubkey = deriveRecipientSubkey(config.BETTER_AUTH_SECRET);
  const ledger = dependencies.ledger ?? noLedger;
  const sendMail = async (message: AuthEmailMessage): Promise<void> => {
    let receipt: Awaited<ReturnType<AuthEmailSender['send']>>;
    try {
      receipt = await dependencies.emailSender.send(message);
    } catch (error) {
      // Delivery failure is a generic retryable outcome: never surface
      // or log the provider exception, recipient or message body here.
      dependencies.logger.log(
        'auth.mail.failed',
        { operation: 'auth.mail.send', errorCode: 'INFRASTRUCTURE' },
        'Auth mail delivery failed',
      );
      throw createAppError('INFRASTRUCTURE', undefined, error);
    }
    if (receipt) {
      try {
        await ledger.record({
          providerMessageId: receipt.providerMessageId,
          recipientHash: recipientKey(recipientSubkey, message.to),
          at: dependencies.clock.now(),
        });
      } catch {
        // The provider accepted the message, so the user has their email:
        // report success. The opaque provider id (no recipient data) keeps
        // the send reconcilable for bounce and complaint correlation.
        dependencies.logger.log(
          'auth.mail.receipt_failed',
          {
            operation: 'auth.mail.send',
            errorCode: 'INFRASTRUCTURE',
            providerMessageId: receipt.providerMessageId,
          },
          'Auth mail receipt was not recorded',
        );
      }
    }
    dependencies.logger.log(
      'auth.mail.sent',
      { operation: 'auth.mail.send' },
      'Auth mail delivered',
    );
  };
  return {
    config,
    instance: composeBetterAuth({
      config,
      recipientSubkey,
      database: dependencies.database,
      deliver: sendMail,
      limiter: dependencies.limiter,
      ledger,
      logger: dependencies.logger,
      ids: dependencies.ids,
      clock: dependencies.clock,
      appendSessionRevoked: dependencies.appendSessionRevoked,
      revokeOtherSessions: dependencies.revokeOtherSessions,
    }),
    limiter: dependencies.limiter,
    logger: dependencies.logger,
    clock: dependencies.clock,
  };
}
