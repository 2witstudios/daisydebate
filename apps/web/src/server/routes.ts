import { composeMessagingRoutes } from '../features/messaging/composition';
import { composeRoomRoutes } from '../features/room-runtime/composition';
import {
  createListSessionsHandler,
  createRevokeSessionHandler,
} from '../features/account/sessions';
import { createOnboardingHandler } from '../features/onboarding/save-answers';
import { createUsernameHandler } from '../features/account/username';
import { createConfirmEmailHandlers } from '../features/auth/email-change/confirm-email';
import { createConfirmHandlers } from '../features/auth/confirmation/confirm';
import { createAuthRouteHandlers } from '../features/auth/handlers';
import { createDebateRoomDocumentHandlers } from '../features/debate-room/documents/document-handlers';
import { createDebateDocumentOperations } from '../features/debate-room/documents/document-operations';
import { createProofHandlers } from '../features/foundation/handlers';
import { createAlertsHandler } from '../features/ops/alerts';
import { createMetricsHandler } from '../features/ops/metrics';
import { createTicketHandler } from '../features/realtime/ticket';
import { identify } from '../lib/identity';
import type { App } from './app';
import { handleOperation } from './http';
import { createReadinessHandler } from './readiness';

/**
 * Every route handler, built from one app. The Next route modules under
 * `app/` only bind these to their paths (`process-app.ts`); tests call the
 * same handlers on an app they built themselves.
 */
export function createRoutes(app: App) {
  const { logger, database } = app;
  const documentOperations = createDebateDocumentOperations({
    store: database,
    clock: app.clock,
    ids: app.ids,
  });
  const origin = () => app.auth().config.PUBLIC_APP_URL;
  /** Same origin, signed-in member, rate limit and actor: the member routes' gates. */
  const memberGates = {
    logger,
    origin,
    identify: (request: Request) => identify(app.auth(), request.headers),
    limiter: () => app.auth().limiter,
    getActorByUserId: (userId: string) => database.getActorByUserId(userId),
  };
  const confirmAuth = () => {
    const { instance, config } = app.auth();
    return { handler: instance.handler, config };
  };
  const rooms = composeRoomRoutes(app);
  return {
    rooms,
    messaging: composeMessagingRoutes(app),
    rounds: { read: rooms.roundRead },
    auth: createAuthRouteHandlers(confirmAuth, logger),
    confirm: createConfirmHandlers({ auth: confirmAuth, logger }),
    confirmEmail: createConfirmEmailHandlers({ auth: confirmAuth, logger }),
    sessions: {
      GET: createListSessionsHandler({
        logger,
        origin,
        listSessions: async (headers) =>
          app.auth().instance.api.listSessions({ headers }),
        currentSessionId: async (headers) => {
          const found = await app.auth().instance.api.getSession({
            headers,
            query: { disableRefresh: true },
          });
          return found?.session.id ?? null;
        },
      }),
    },
    revokeSession: {
      POST: createRevokeSessionHandler({
        logger,
        origin,
        listSessions: async (headers) =>
          app.auth().instance.api.listSessions({ headers }),
        revokeToken: async (headers, token) => {
          await app
            .auth()
            .instance.api.revokeSession({ headers, body: { token } });
        },
      }),
    },
    username: {
      POST: createUsernameHandler({
        logger,
        origin,
        identify: (request) => identify(app.auth(), request.headers),
        limiter: () => app.auth().limiter,
        claim: (input) => database.claimUsername(input),
      }),
    },
    onboarding: {
      POST: createOnboardingHandler({
        logger,
        origin,
        identify: (request) => identify(app.auth(), request.headers),
        limiter: () => app.auth().limiter,
        clock: app.clock,
        save: (userId, answers) => database.saveOnboardingStep(userId, answers),
        complete: (userId, at) => database.completeOnboarding(userId, at),
      }),
    },
    ticket: {
      POST: createTicketHandler({
        logger,
        origin,
        identify: (request) => identify(app.auth(), request.headers),
        sessionId: async (headers) => {
          const found = await app.auth().instance.api.getSession({
            headers,
            query: { disableRefresh: true },
          });
          return found?.session.id ?? null;
        },
        limiter: () => app.auth().limiter,
        getActorByUserId: (userId) => database.getActorByUserId(userId),
        issueTicket: (input) =>
          app.redis.issueConnectTicket(
            input.ticketHash,
            {
              actorId: input.actorId,
              sessionId: input.sessionId,
              origin: input.origin,
            },
            input.ttlSeconds,
          ),
      }),
    },
    debateRoomDocuments: createDebateRoomDocumentHandlers({
      ...memberGates,
      operations: () => documentOperations,
    }),
    /** Provider-signed, server-to-server: authenticity replaces the origin check. */
    mailWebhook: {
      POST: (request: Request) =>
        handleOperation(logger, request, 'auth.mail.webhook', () =>
          app.mailWebhook().handle(request),
        ),
    },
    foundationProof: createProofHandlers({
      enabled: app.config.FOUNDATION_PROOF_ENABLED,
      origin: app.config.PUBLIC_APP_URL,
      database,
      ids: app.ids,
      logger,
    }),
    ready: {
      GET: createReadinessHandler({
        database,
        redis: app.redis,
        isDraining: app.isDraining,
        logger,
      }),
    },
    ops: {
      alerts: {
        GET: createAlertsHandler({
          logger,
          redis: app.redis,
          local: app.localAlertState,
          clock: app.clock,
          token: () => app.opsProbeToken(),
        }),
      },
      metrics: {
        GET: createMetricsHandler({
          logger,
          metrics: app.metrics,
          token: () => app.opsProbeToken(),
        }),
      },
    },
  };
}

export type Routes = ReturnType<typeof createRoutes>;
