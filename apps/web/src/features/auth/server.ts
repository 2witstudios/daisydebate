import { betterAuth } from 'better-auth';
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { createAppError } from '@daisy/errors';
import type { Clock, IdGenerator } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import { readAuthConfig, type AuthConfig } from '@daisy/config';
import { buildConfirmLink } from './confirm-link';
import { createMagicLinkGate } from './magic-link-gate';
import { recipientHash } from './mail';
import { unavailable } from './public-errors';
import {
  clientIpFromConfig,
  clientIpOptions,
  createRateLimitGate,
  type AuthRateLimiter,
  type ClientIpTrust,
} from './rate-limit';

const MAGIC_LINK_EXPIRES_IN_SECONDS = 300;

/** Application-level email contract; the Resend transport plugs in here. */
export type AuthEmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};
/** Provider receipt; correlates later delivery events, holds no recipient data. */
type AuthEmailReceipt = { readonly providerMessageId: string };
export type AuthEmailSender = {
  readonly send: (
    message: AuthEmailMessage,
  ) => Promise<AuthEmailReceipt | void>;
};
/** Durable mail diagnostics + suppression owned by @daisy/db. */
export type AuthDeliveryLedger = {
  readonly isSuppressed: (recipientHash: string) => Promise<boolean>;
  readonly record: (input: {
    readonly providerMessageId: string;
    readonly recipientHash: string;
    readonly at: string;
  }) => Promise<void>;
};
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
  readonly database: BetterAuthOptions['database'];
  readonly deliver: (message: AuthEmailMessage) => Promise<void>;
  readonly limiter: AuthRateLimiter;
  readonly ledger: AuthDeliveryLedger;
  readonly logger: Logger;
  readonly ids: IdGenerator;
  readonly clientIp: ClientIpTrust | undefined;
}) => {
  const { config, ledger } = dependencies;
  const origin = new URL(config.PUBLIC_APP_URL).origin;
  const magicLinkGate = createMagicLinkGate({
    secret: config.BETTER_AUTH_SECRET,
    ledger,
  });
  /** Runs after the rate-limit gate: a throttled request does no lookups. */
  const magicLinkGatePlugin: BetterAuthPlugin = {
    id: 'daisy-magic-link-gate',
    hooks: {
      before: [
        {
          matcher: (context) => context.path === '/sign-in/magic-link',
          handler: createAuthMiddleware(async (context) => {
            await magicLinkGate(context.body);
          }),
        },
      ],
    },
  };
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
            { source: 'better-auth', level },
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
      // No request header names the client unless explicitly trusted.
      ipAddress: clientIpOptions(dependencies.clientIp),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 60,
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
      '/change-email',
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
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }) => {
          const href = buildConfirmLink(origin, url).toString();
          try {
            await dependencies.deliver({
              to: email,
              subject: 'Sign in to Daisy',
              text: `Open the link to continue. It expires in 5 minutes and works once: ${href}`,
              html: `<p>Open the link to continue. It expires in 5 minutes and works once.</p><p><a href="${href.replaceAll('&', '&amp;')}">Sign in to Daisy</a></p>`,
            });
          } catch {
            throw unavailable(
              'EMAIL_DELIVERY_FAILED',
              'We could not send the email. Please try again.',
            );
          }
        },
      }),
      passkey({
        rpID: new URL(config.PUBLIC_APP_URL).hostname,
        rpName: 'Daisy',
        origin,
      }),
      magicLinkGatePlugin,
    ],
  });
  return {
    ...instance,
    handler: async (request: Request): Promise<Response> => {
      try {
        return await instance.handler(request);
      } catch {
        dependencies.logger.log(
          'request.unhandled',
          { source: 'better-auth' },
          'Authentication request failed',
        );
        return new Response(null, { status: 500 });
      }
    },
  };
};

/**
 * Composition of one auth instance over the existing process resources.
 * The database adapter is an opaque capability from @daisy/db — this seam
 * never opens a second SQL or Redis pool and never imports transport code.
 */
export type AuthServer<Database extends BetterAuthOptions['database']> = {
  readonly config: AuthConfig;
  readonly instance: AuthInstance;
  readonly database: Database;
  readonly mail: {
    readonly send: (message: AuthEmailMessage) => Promise<void>;
  };
  readonly limiter: AuthRateLimiter;
  readonly ledger: AuthDeliveryLedger;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly ids: IdGenerator;
};

/**
 * Lazy auth factory: calling it validates configuration and composes the
 * injected dependencies; it performs no I/O and dials no service. Importing
 * this module requires no credentials and contacts nothing.
 */
export function createAuthServer<
  Database extends BetterAuthOptions['database'],
>(dependencies: {
  readonly env: Record<string, string | undefined>;
  readonly database: Database;
  readonly emailSender: AuthEmailSender;
  readonly limiter: AuthRateLimiter;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /**
   * Trusted client-IP header(s) for rate-limit keying. Omitted means the
   * validated `AUTH_TRUSTED_IP_HEADERS` / `AUTH_TRUSTED_PROXIES` apply,
   * which believe no request header unless the deployment sets them.
   */
  readonly clientIp?: ClientIpTrust | undefined;
  /** Mail receipts and suppressions (production supplies the @daisy/db one). */
  readonly ledger?: AuthDeliveryLedger | undefined;
}): AuthServer<Database> {
  const config = readAuthConfig(dependencies.env);
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
          recipientHash: recipientHash(config.BETTER_AUTH_SECRET, message.to),
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
      database: dependencies.database,
      deliver: sendMail,
      limiter: dependencies.limiter,
      ledger,
      logger: dependencies.logger,
      ids: dependencies.ids,
      // Explicit injection wins; otherwise the validated environment decides.
      clientIp: dependencies.clientIp ?? clientIpFromConfig(config),
    }),
    database: dependencies.database,
    mail: { send: sendMail },
    limiter: dependencies.limiter,
    ledger,
    logger: dependencies.logger,
    clock: dependencies.clock,
    ids: dependencies.ids,
  };
}
