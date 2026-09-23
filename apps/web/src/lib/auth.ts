import { readAuthConfig } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { clientIpFromConfig } from '../features/auth/rate-limit';
import { createAuthServer, type AuthServer } from '../features/auth/server';
import { CLIENT_IP_HEADER } from '../features/auth/client-ip';
import { createResendSender } from '../features/auth/mail';
import { createResendWebhook } from '../features/auth/webhook';
import { createAuthRateLimiter } from '../features/auth/redis-limiter';
import { getResources } from '../server/resources';

type Auth = AuthServer<
  ReturnType<typeof getResources>['database']['authAdapter']
>;

// The composed instance holds no service connections of its own: it shares
// the process resources (Bun SQL pool, Redis client) and is built on first use,
// so importing route modules during `next build` dials nothing.
const processState = globalThis as typeof globalThis & { daisyAuth?: Auth };

/** Lazy composition entrypoint for auth route handlers. */
export function getAuth(): Auth {
  if (processState.daisyAuth) return processState.daisyAuth;
  const resources = getResources();
  const config = readAuthConfig(process.env);
  const trust = clientIpFromConfig(config);
  processState.daisyAuth = createAuthServer({
    env: process.env,
    database: resources.database.authAdapter,
    emailSender: createResendSender({
      apiKey: config.RESEND_API_KEY,
      from: config.AUTH_EMAIL_FROM,
      ids: resources.ids,
    }),
    limiter: createAuthRateLimiter(resources.redis),
    // Only the identity our own ingress stamps names the client (ADR 0025).
    clientIp: {
      ...trust,
      trustedHeaders: [CLIENT_IP_HEADER, ...trust.trustedHeaders],
    },
    ledger: {
      isSuppressed: (hash) => resources.database.isRecipientSuppressed(hash),
      record: (input) => resources.database.recordEmailDelivery(input),
    },
    appendSessionRevoked: (userId) =>
      resources.database.appendSessionRevoked(userId),
    revokeOtherSessions: (userId, keepToken) =>
      resources.database.revokeOtherSessions(userId, keepToken),
    logger: resources.logger,
    clock: resources.clock,
    ids: resources.ids,
  });
  return processState.daisyAuth;
}

/** Shared seam for the confirm pages' internal forward (`confirm.ts`, `confirm-email.ts`). */
export const confirmAuth = () => {
  const { instance, config } = getAuth();
  return { handler: instance.handler, config };
};

type MailWebhook = ReturnType<typeof createResendWebhook>;
const webhookState = globalThis as typeof globalThis & {
  daisyMailWebhook?: MailWebhook;
};

/** Lazy Resend webhook composition; refuses when the signing secret is unset. */
export function getMailWebhook(): MailWebhook {
  if (webhookState.daisyMailWebhook) return webhookState.daisyMailWebhook;
  const resources = getResources();
  const config = readAuthConfig(process.env);
  if (!config.RESEND_WEBHOOK_SECRET) throw createAppError('INFRASTRUCTURE');
  webhookState.daisyMailWebhook = createResendWebhook({
    secret: config.RESEND_WEBHOOK_SECRET,
    apiKey: config.RESEND_API_KEY,
    clock: resources.clock,
    apply: (input) => resources.database.applyEmailDeliveryEvent(input),
  });
  return webhookState.daisyMailWebhook;
}
