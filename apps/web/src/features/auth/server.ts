import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { createAppError } from '@daisy/errors';
import type { Clock, IdGenerator } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import { readAuthConfig, type AuthConfig } from '@daisy/config';
import {
  clientIpFromConfig,
  clientIpOptions,
  createRateLimitGate,
  type AuthRateLimiter,
  type ClientIpTrust,
} from './rate-limit';

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
/**
 * The composed Better Auth instance with the passwordless plugins applied.
 * Created lazily by the factory; importing this module performs no I/O.
 */
type AuthInstance = ReturnType<typeof composeBetterAuth>;

const composeBetterAuth = (dependencies: {
  readonly config: AuthConfig;
  readonly database: BetterAuthOptions['database'];
  readonly emailSender: AuthEmailSender;
  readonly limiter: AuthRateLimiter;
  readonly logger: Logger;
  readonly ids: IdGenerator;
  readonly clientIp: ClientIpTrust | undefined;
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
        // Entity identifiers come from the injected generator (cuid2 at
        // the production edge, ADR 0018), never an ambient one.
        generateId: () => dependencies.ids.next(),
      },
      // No request header names the client unless explicitly trusted.
      ipAddress: clientIpOptions(dependencies.clientIp),
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
  /**
   * Trusted client-IP header(s) for rate-limit keying. Omitted means the
   * validated `AUTH_TRUSTED_IP_HEADERS` / `AUTH_TRUSTED_PROXIES` apply,
   * which believe no request header unless the deployment sets them.
   */
  readonly clientIp?: ClientIpTrust | undefined;
}): AuthServer<Database> {
  const config = readAuthConfig(dependencies.env);
  const sendMail: AuthEmailSender['send'] = async (message) => {
    try {
      await dependencies.emailSender.send(message);
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
      emailSender: { send: sendMail },
      limiter: dependencies.limiter,
      logger: dependencies.logger,
      ids: dependencies.ids,
      // Explicit injection wins; otherwise the validated environment decides.
      clientIp: dependencies.clientIp ?? clientIpFromConfig(config),
    }),
    database: dependencies.database,
    mail: { send: sendMail },
    limiter: dependencies.limiter,
    logger: dependencies.logger,
    clock: dependencies.clock,
    ids: dependencies.ids,
  };
}
