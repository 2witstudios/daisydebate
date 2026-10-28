import { composeAttendanceRoutes } from '../features/attendance/composition';
import { composeMediaCaptureRoutes } from '../features/media-capture/composition';
import { composeRoundAnalysisRoutes } from '../features/round-analysis/composition';
import { composeRoundBallotRoutes } from '../features/round-ballots/composition';
import { createRoundMediaHandlers } from '../features/round-media/handlers';
import { createRoundMediaRuntime } from '../features/round-media/composition';
import { composeRoundRoutes } from '../features/round-runtime/composition';
import { composeMessagingRoutes } from '../features/messaging/composition';
import { composeFriendRoutes } from '../features/messaging/friends/composition';
import { composeRoomRoutes } from '../features/room-runtime/composition';
import {
  createListSessionsHandler,
  createRevokeSessionHandler,
} from '../features/account/sessions';
import { createOnboardingHandler } from '../features/onboarding/save-answers';
import { createSignOutFormHandler } from '../features/auth/sessions/sign-out-form';
import { createAgeStepHandler } from '../features/account/age-step';
import { ACCOUNT_AGE_FLOOR } from '@daisy/auth/age-floor';
import { TERMS_VERSION } from '../features/legal/versions';
import { provisionalMailCleanup } from '../features/auth/mail/provisional-mail';
import { admitsOptionalAnswers } from '@daisy/auth/account-age';
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
  const auth = createAuthRouteHandlers(confirmAuth, logger);
  const provisionalMail = provisionalMailCleanup(
    () => app.auth().config.RECIPIENT_HASH_SECRET,
  );
  return {
    mediaCapture: composeMediaCaptureRoutes(app),
    roundMedia: createRoundMediaHandlers({
      ...memberGates,
      active: () => Boolean(app.roomPolicy),
      operations: createRoundMediaRuntime(app).operations,
    }),
    rooms,
    attendance: composeAttendanceRoutes(app, memberGates),
    messaging: composeMessagingRoutes(app),
    friends: composeFriendRoutes(app),
    rounds: {
      read: rooms.roundRead,
      ...composeRoundRoutes(app),
      ...composeRoundBallotRoutes(app),
      ...composeRoundAnalysisRoutes(app),
    },
    auth,
    signOut: {
      POST: createSignOutFormHandler({ logger, origin, signOut: auth.POST }),
    },
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
        hasRecordedAge: (userId) => database.hasRecordedAge(userId),
      }),
    },
    age: {
      POST: createAgeStepHandler({
        logger,
        origin,
        identify: (request) => identify(app.auth(), request.headers),
        limiter: () => app.auth().limiter,
        clock: app.clock,
        floor: ACCOUNT_AGE_FLOOR,
        termsVersion: TERMS_VERSION,
        record: (input) => database.recordAgeStep(input),
        forget: (userId) =>
          database.deleteProvisionalUser({ userId, ...provisionalMail }),
      }),
    },
    onboarding: {
      POST: createOnboardingHandler({
        logger,
        origin,
        identify: (request) => identify(app.auth(), request.headers),
        limiter: () => app.auth().limiter,
        clock: app.clock,
        save: (input) =>
          database.saveOnboardingStep({
            ...input,
            admits: admitsOptionalAnswers,
          }),
        complete: (userId, at) => database.completeOnboarding(userId, at),
      }),
    },
    ticket: {
      POST: createTicketHandler({
        logger,
        websocketEndpoint: () => app.websocketEndpoint,
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
