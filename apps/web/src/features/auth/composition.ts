import type { App } from '../../server/app';
import { defineComposition } from '../../server/composition';
import { createConfirmHandlers } from './confirmation/confirm';
import { createConfirmEmailHandlers } from './email-change/confirm-email';
import { createAuthRouteHandlers } from './handlers';
import { createSignOutFormHandler } from './sessions/sign-out-form';

const confirmAuth = (app: App) => () => {
  const { instance, config } = app.auth();
  return { handler: instance.handler, config };
};

const authHandlers = (app: App) =>
  createAuthRouteHandlers(confirmAuth(app), app.logger, app.reporter);

/** auth: the auth server's catch-all route binds here (`processRoute`). */
export const authComposition = defineComposition('auth', authHandlers);

/** sign-out: the sign-out form posts through the auth server's own route. */
export const signOutComposition = defineComposition('sign-out', (app) => ({
  POST: createSignOutFormHandler({
    logger: app.logger,
    origin: () => app.auth().config.PUBLIC_APP_URL,
    signOut: authHandlers(app).POST,
  }),
}));

/** confirm: the emailed-link confirmation routes bind here. */
export const confirmComposition = defineComposition('confirm', (app) =>
  createConfirmHandlers({
    auth: confirmAuth(app),
    logger: app.logger,
    reporter: app.reporter,
  }),
);

/** confirm-email: the email-change confirmation routes bind here. */
export const confirmEmailComposition = defineComposition(
  'confirm-email',
  (app) =>
    createConfirmEmailHandlers({
      auth: confirmAuth(app),
      logger: app.logger,
      reporter: app.reporter,
    }),
);
