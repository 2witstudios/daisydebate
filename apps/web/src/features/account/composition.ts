import { identify } from '../../lib/identity';
import type { App } from '../../server/app';
import { defineComposition } from '../../server/composition';
import { provisionalMailCleanup } from '../auth/mail/provisional-mail';
import { TERMS_VERSION } from '../legal/versions';
import { createAgeStepHandler } from './age-step';
import {
  createListSessionsHandler,
  createRevokeSessionHandler,
} from './sessions';
import { createUsernameHandler } from './username';

const origin = (app: App) => () => app.auth().config.PUBLIC_APP_URL;
const listSessions = (app: App) => async (headers: Headers) =>
  app.auth().instance.api.listSessions({ headers });

/** sessions: the account's session list binds here (`processRoute`). */
export const sessionsComposition = defineComposition('sessions', (app) => ({
  GET: createListSessionsHandler({
    logger: app.logger,
    reporter: app.reporter,
    origin: origin(app),
    listSessions: listSessions(app),
    currentSessionId: async (headers) => {
      const found = await app.auth().readSession(headers);
      return found?.session.id ?? null;
    },
  }),
}));

/** revoke-session: revoking one of the account's sessions binds here. */
export const revokeSessionComposition = defineComposition(
  'revoke-session',
  (app) => ({
    POST: createRevokeSessionHandler({
      logger: app.logger,
      reporter: app.reporter,
      origin: origin(app),
      listSessions: listSessions(app),
      revokeToken: async (headers, token) => {
        await app
          .auth()
          .instance.api.revokeSession({ headers, body: { token } });
      },
    }),
  }),
);

/** username: claiming a username binds here. */
export const usernameComposition = defineComposition('username', (app) => ({
  POST: createUsernameHandler({
    logger: app.logger,
    reporter: app.reporter,
    origin: origin(app),
    identify: (request) => identify(app.auth(), request.headers),
    limiter: () => app.limiter,
    claim: (input) => app.database.claimUsername(input),
    hasRecordedAge: (userId) => app.database.hasRecordedAge(userId),
  }),
}));

/** age: the age step binds here, with or without parental controls. */
export const ageComposition = defineComposition('age', (app) => {
  const { logger, database } = app;
  const provisionalMail = provisionalMailCleanup(
    () => app.mailConfig().RECIPIENT_HASH_SECRET,
  );
  const ageDependencies = {
    logger,
    reporter: app.reporter,
    origin: origin(app),
    identify: (request) => identify(app.auth(), request.headers),
    limiter: () => app.limiter,
    clock: app.clock,
    termsVersion: TERMS_VERSION,
    record: (input) => database.recordAgeStep(input),
    forget: (userId) =>
      database.deleteProvisionalUser({ userId, ...provisionalMail }),
  } satisfies Parameters<typeof createAgeStepHandler>[0];
  return {
    POST: createAgeStepHandler(ageDependencies),
    withParentalControls: (released: (userId: string) => Promise<boolean>) =>
      createAgeStepHandler({
        ...ageDependencies,
        parentalControls: {
          released,
          binding: database.childAccountBinding,
        },
      }),
  };
});
