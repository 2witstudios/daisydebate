import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { createId } from '@paralleldrive/cuid2';
import { createAppError } from '@daisy/errors';
import type { Clock, IdGenerator } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import { readAuthConfig, type AuthConfig } from '@daisy/config';
import { CLIENT_IP_HEADER } from './client-ip';
import { recipientHash } from './mail';
import { safeLocalDestination } from './redirect';

const MAGIC_LINK_WINDOW_SECONDS = 60;
const MAGIC_LINK_MAX = 3;
const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX = 100;
const MAGIC_LINK_EXPIRES_IN_SECONDS = 300;

/** Application-level email contract; the Resend transport plugs in here. */
export type AuthEmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};
/** Provider receipt; correlates later delivery events, holds no recipient data. */
export type AuthEmailReceipt = { readonly providerMessageId: string };
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
/** Atomic multi-instance limiter contract backed by @daisy/redis. */
export type AuthRateLimiter = {
  readonly consume: (
    key: string,
    rule: { readonly windowSeconds: number; readonly max: number },
  ) => Promise<{
    readonly allowed: boolean;
    readonly retryAfterSeconds: number;
  }>;
};
/**
 * The composed Better Auth instance with the passwordless plugins applied.
 * Created lazily by the factory; importing this module performs no I/O.
 */
type AuthInstance = ReturnType<typeof composeBetterAuth>;

/** Safe, retryable public failures; details never reach the response. */
const unavailable = (code: string, message: string) =>
  new APIError(
    'SERVICE_UNAVAILABLE',
    { code, message },
    { 'Retry-After': '5' },
  );

const composeBetterAuth = (dependencies: {
  readonly config: AuthConfig;
  readonly database: BetterAuthOptions['database'];
  readonly deliver: (message: AuthEmailMessage) => Promise<void>;
  readonly limiter: AuthRateLimiter;
  readonly ledger: AuthDeliveryLedger;
}) => {
  const { config, limiter, ledger } = dependencies;
  const origin = new URL(config.PUBLIC_APP_URL).origin;
  /** A limiter outage is never an allow and never a process-local count. */
  const consume = async (
    key: string,
    rule: { readonly windowSeconds: number; readonly max: number },
  ) => {
    try {
      return await limiter.consume(key, rule);
    } catch (error) {
      throw createAppError('INFRASTRUCTURE', undefined, error);
    }
  };
  return betterAuth({
    baseURL: config.PUBLIC_APP_URL,
    trustedOrigins: [origin],
    secret: config.BETTER_AUTH_SECRET,
    database: dependencies.database,
    advanced: {
      database: {
        // Entity identifiers are unguessable cuid2, not UUIDs.
        generateId: () => createId(),
      },
      // Only the ingress-stamped identity selects a rate-limit bucket; every
      // caller-controlled forwarding header is ignored.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 60,
      // Revocation must be visible on the next server check.
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      window: DEFAULT_WINDOW_SECONDS,
      max: DEFAULT_MAX,
      customStorage: {
        consume: async (key, rule) => {
          const decision = await consume(key, {
            windowSeconds: rule.window,
            max: rule.max,
          });
          return {
            allowed: decision.allowed,
            retryAfter: decision.allowed ? null : decision.retryAfterSeconds,
          };
        },
      },
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
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/magic-link') return;
        for (const destination of [
          ctx.body?.callbackURL,
          ctx.body?.newUserCallbackURL,
          ctx.body?.errorCallbackURL,
        ])
          // Local paths only: external, protocol-relative and encoded forms fail.
          if (
            destination !== undefined &&
            safeLocalDestination(destination, '') === ''
          )
            throw new APIError('FORBIDDEN', {
              code: 'INVALID_CALLBACK_URL',
              message: 'Invalid callback URL',
            });
        const email =
          typeof ctx.body?.email === 'string'
            ? ctx.body.email.trim().toLowerCase()
            : '';
        if (!email) return;
        const digest = recipientHash(config.BETTER_AUTH_SECRET, email);
        let recipientDecision;
        let suppressed: boolean;
        try {
          recipientDecision = await limiter.consume(
            `magic-link-recipient|${digest}`,
            { windowSeconds: MAGIC_LINK_WINDOW_SECONDS, max: MAGIC_LINK_MAX },
          );
          suppressed = recipientDecision.allowed
            ? await ledger.isSuppressed(digest)
            : false;
        } catch {
          throw unavailable(
            'AUTH_TEMPORARILY_UNAVAILABLE',
            'Sign-in is temporarily unavailable. Please try again shortly.',
          );
        }
        if (!recipientDecision.allowed)
          throw new APIError(
            'TOO_MANY_REQUESTS',
            {
              code: 'RATE_LIMITED',
              message: 'Too many requests. Please try again later.',
            },
            { 'Retry-After': String(recipientDecision.retryAfterSeconds) },
          );
        if (suppressed)
          // A prior hard bounce or complaint: never loop automatic resends.
          throw new APIError('UNPROCESSABLE_ENTITY', {
            code: 'EMAIL_UNDELIVERABLE',
            message:
              'We cannot send sign-in emails to this address. Sign in with a passkey or use a different address.',
          });
      }),
    },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
        storeToken: 'hashed',
        rateLimit: { window: MAGIC_LINK_WINDOW_SECONDS, max: MAGIC_LINK_MAX },
        sendMagicLink: async ({ email, url }) => {
          // The emailed link opens a no-store confirmation page; the token is
          // only redeemed by an explicit same-origin POST (scanner safety).
          const source = new URL(url);
          const link = new URL('/auth/confirm', origin);
          link.searchParams.set(
            'token',
            source.searchParams.get('token') ?? '',
          );
          // Better Auth defaults an absent destination to "/"; ours is /lobby.
          const requested = source.searchParams.get('callbackURL');
          link.searchParams.set(
            'callbackURL',
            safeLocalDestination(requested === '/' ? null : requested),
          );
          const newUser = source.searchParams.get('newUserCallbackURL');
          if (newUser)
            link.searchParams.set(
              'newUserCallbackURL',
              safeLocalDestination(newUser),
            );
          const href = link.toString();
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
    ],
  });
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
  readonly ledger: AuthDeliveryLedger;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}): AuthServer<Database> {
  const config = readAuthConfig(dependencies.env);
  const sendMail = async (message: AuthEmailMessage): Promise<void> => {
    try {
      const receipt = await dependencies.emailSender.send(message);
      if (receipt)
        await dependencies.ledger.record({
          providerMessageId: receipt.providerMessageId,
          recipientHash: recipientHash(config.BETTER_AUTH_SECRET, message.to),
          at: dependencies.clock.now(),
        });
    } catch (error) {
      // Delivery failure is a generic retryable outcome: never surface
      // or log the provider exception, recipient or message body here.
      throw createAppError('INFRASTRUCTURE', undefined, error);
    }
  };
  return {
    config,
    instance: composeBetterAuth({
      config,
      database: dependencies.database,
      deliver: sendMail,
      limiter: dependencies.limiter,
      ledger: dependencies.ledger,
    }),
    database: dependencies.database,
    mail: { send: sendMail },
    limiter: dependencies.limiter,
    ledger: dependencies.ledger,
    logger: dependencies.logger,
    clock: dependencies.clock,
    ids: dependencies.ids,
  };
}
