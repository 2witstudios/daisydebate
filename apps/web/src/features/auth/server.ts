import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { createId } from '@paralleldrive/cuid2';
import { createAppError } from '@daisy/errors';
import type { Clock, IdGenerator } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import { readAuthConfig, type AuthConfig } from '@daisy/config';

/** Application-level email contract; the Resend transport plugs in here. */
export type AuthEmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};
export type AuthEmailSender = {
  readonly send: (message: AuthEmailMessage) => Promise<void>;
};
/** Atomic multi-instance limiter contract backed by @daisy/redis. */
export type AuthRateLimiter = {
  readonly consume: (key: string) => Promise<{
    readonly allowed: boolean;
    readonly retryAfterSeconds: number;
  }>;
};
/**
 * The composed Better Auth instance with the passwordless plugins applied.
 * Created lazily by the factory; importing this module performs no I/O.
 */
type AuthInstance = ReturnType<typeof composeBetterAuth>;

const composeBetterAuth = (dependencies: {
  readonly config: AuthConfig;
  readonly database: BetterAuthOptions['database'];
  readonly emailSender: AuthEmailSender;
  readonly logger: Logger;
}) => {
  const origin = new URL(dependencies.config.PUBLIC_APP_URL).origin;
  const instance = betterAuth({
    baseURL: dependencies.config.PUBLIC_APP_URL,
    trustedOrigins: [origin],
    secret: dependencies.config.BETTER_AUTH_SECRET,
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
        // Entity identifiers are unguessable cuid2, not UUIDs.
        generateId: () => createId(),
      },
    },
    emailAndPassword: { enabled: false },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await dependencies.emailSender.send({
            to: email,
            subject: 'Sign in to Daisy',
            text: `Open the link to continue: ${url}`,
            html: `<p>Open the link to continue: <a href="${url}">Sign in to Daisy</a></p>`,
          });
        },
      }),
      passkey({
        rpID: new URL(dependencies.config.PUBLIC_APP_URL).hostname,
        rpName: 'Daisy',
        origin,
      }),
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
}): AuthServer<Database> {
  const config = readAuthConfig(dependencies.env);
  const sendMail: AuthEmailSender['send'] = async (message) => {
    try {
      await dependencies.emailSender.send(message);
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
      emailSender: { send: sendMail },
      logger: dependencies.logger,
    }),
    database: dependencies.database,
    mail: { send: sendMail },
    limiter: dependencies.limiter,
    logger: dependencies.logger,
    clock: dependencies.clock,
    ids: dependencies.ids,
  };
}
