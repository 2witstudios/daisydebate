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
 * Composition of one auth instance over the existing process resources.
 * The database adapter is an opaque capability from @daisy/db — this seam
 * never opens a second SQL or Redis pool and never imports transport code.
 */
export type AuthServer<Database> = {
  readonly config: AuthConfig;
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
export function createAuthServer<Database>(dependencies: {
  readonly env: Record<string, string | undefined>;
  readonly database: Database;
  readonly emailSender: AuthEmailSender;
  readonly limiter: AuthRateLimiter;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}): AuthServer<Database> {
  const config = readAuthConfig(dependencies.env);
  return {
    config,
    database: dependencies.database,
    mail: {
      send: async (message) => {
        try {
          await dependencies.emailSender.send(message);
        } catch (error) {
          // Delivery failure is a generic retryable outcome: never surface
          // or log the provider exception, recipient or message body here.
          throw createAppError('INFRASTRUCTURE', undefined, error);
        }
      },
    },
    limiter: dependencies.limiter,
    logger: dependencies.logger,
    clock: dependencies.clock,
    ids: dependencies.ids,
  };
}
