import { defineComposition } from '../../server/composition';
import { handleOperation } from '../../server/http';

/** mail-webhook: provider-signed, server-to-server; authenticity replaces the origin check. */
export const mailWebhookComposition = defineComposition(
  'mail-webhook',
  (app) => ({
    POST: (request: Request) =>
      handleOperation(
        app.logger,
        request,
        'mail.webhook',
        () => app.mailWebhook().handle(request),
        app.reporter,
      ),
  }),
);
