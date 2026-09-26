import type { Clock, IdGenerator } from '@daisy/clock';
import {
  readAuthConfig,
  readServerConfig,
  type AuthConfig,
} from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import { createLogger } from '@daisy/logger';
import { createDrainState } from '@daisy/observability';
import { createRedis } from '@daisy/redis';
import { createResendSender, type Fetch } from '../features/auth/mail';
import { createAuthRateLimiter } from '../features/auth/redis-limiter';
import { createAuthServer, type AuthServer } from '../features/auth/server';
import { createResendWebhook } from '../features/auth/webhook';
import { createAlertRecorder, withAlertRecording } from './alert-recorder';
import { createMetricsStore, type MetricsStore } from './metrics-store';

export type AppDependencies = {
  /** Raw environment, validated here and nowhere else. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Outbound HTTP (the Resend mail transport). */
  readonly fetch: Fetch;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Where log lines go; standard output when omitted. */
  readonly logDestination?: { readonly write: (line: string) => void };
};

/**
 * The composition root: one call builds the whole web application graph
 * (validated config, logger, database, Redis, auth, rate limiter, mail and
 * the delivery webhook) from explicit dependencies. It reads no ambient
 * state, so any number of instances coexist in one process; only the
 * process edge (`process-app.ts`) keeps one for the server to share.
 *
 * Database and Redis clients dial lazily, so building an app contacts
 * nothing. Auth configuration is validated when auth is first used (ADR
 * 0020: baseline startup never requires auth variables); each instance
 * composes auth at most once.
 */
export function createApp({
  env,
  fetch,
  clock,
  ids,
  logDestination,
}: AppDependencies) {
  const config = readServerConfig(env);
  const baseLogger = createLogger({
    service: 'web',
    level: config.LOG_LEVEL,
    appVersion: config.APP_VERSION,
    gitCommit: config.GIT_COMMIT,
    ...(logDestination ? { destination: logDestination } : {}),
  });
  const metrics: MetricsStore = createMetricsStore();
  const redis = createRedis({
    url: config.REDIS_URL,
    namespace: config.REDIS_NAMESPACE,
    eventSink: baseLogger.log,
  });
  const alertRecorder = createAlertRecorder({ redis, clock });
  // AUTH-7.7: every existing `logger.log` call site (auth, retention, HTTP)
  // feeds both the durable Redis alert state and the in-process metrics
  // counters, with no per-site change.
  const logger = withAlertRecording(
    withAlertRecording(baseLogger, alertRecorder),
    metrics,
  );
  const database = createDatabase({
    url: config.DATABASE_URL,
    eventSink: logger.log,
    nextActorId: () => ids.next(),
  });
  let authConfig: AuthConfig | undefined;
  let auth: AuthServer | undefined;
  let mailWebhook: ReturnType<typeof createResendWebhook> | undefined;
  /** Parsed once, on first use, and shared by auth and the webhook. */
  const readAuth = (): AuthConfig => (authConfig ??= readAuthConfig(env));
  const composeAuth = (): AuthServer => {
    const authConfig = readAuth();
    return createAuthServer({
      config: authConfig,
      database: database.authAdapter,
      emailSender: createResendSender({
        apiKey: authConfig.RESEND_API_KEY,
        from: authConfig.AUTH_EMAIL_FROM,
        ids,
        fetch,
      }),
      limiter: createAuthRateLimiter(redis),
      ledger: {
        isSuppressed: (hash) => database.isRecipientSuppressed(hash),
        record: (input) => database.recordEmailDelivery(input),
      },
      appendSessionRevoked: (userId) => database.appendSessionRevoked(userId),
      revokeOtherSessions: (userId, keepToken) =>
        database.revokeOtherSessions(userId, keepToken),
      completeEmailChange: (input) => database.completeEmailChange(input),
      revokeSessionUnlessAddressHeld: (input) =>
        database.revokeSessionUnlessAddressHeld(input),
      logger,
      clock,
      ids,
    });
  };
  const composeMailWebhook = () => {
    const authConfig = readAuth();
    // Refuses rather than accept unsigned deliveries.
    if (!authConfig.RESEND_WEBHOOK_SECRET)
      throw createAppError('INFRASTRUCTURE');
    return createResendWebhook({
      secret: authConfig.RESEND_WEBHOOK_SECRET,
      apiKey: authConfig.RESEND_API_KEY,
      clock,
      apply: (input) => database.applyEmailDeliveryEvent(input),
    });
  };
  return {
    config,
    clock,
    ids,
    logger,
    database,
    redis,
    /** AUTH-7.7's bounded-cardinality in-process counters (`/api/ops/metrics`). */
    metrics,
    /** The composed auth server, validated and built on first use. */
    auth: (): AuthServer => (auth ??= composeAuth()),
    /**
     * `OPS_PROBE_TOKEN` (AUTH-7.7): refuses, like the webhook secret, rather
     * than serve `/api/ops/alerts`/`/api/ops/metrics` unauthenticated.
     */
    opsProbeToken: (): string => {
      const token = readAuth().OPS_PROBE_TOKEN;
      if (!token) throw createAppError('INFRASTRUCTURE');
      return token;
    },
    /** The Resend delivery webhook; refuses when the signing secret is unset. */
    mailWebhook: () => (mailWebhook ??= composeMailWebhook()),
    /** isDraining, drain, and close (drains, then closes both pools). */
    ...createDrainState([database, redis]),
  };
}

export type App = ReturnType<typeof createApp>;
