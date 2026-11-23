import { defineComposition } from '../../server/composition';
import { memberHttpBoundary } from '../auth/member-boundary';
import { createTicketHandler } from './ticket';

/** realtime-ticket: the connect-ticket route binds here (`processRoute`). */
export const ticketComposition = defineComposition(
  'realtime-ticket',
  (app) => ({
    POST: createTicketHandler({
      ...memberHttpBoundary(app),
      websocketEndpoint: () => app.websocketEndpoint,
      sessionId: async (headers) => {
        const found = await app.auth().readSession(headers);
        return found?.session.id ?? null;
      },
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
  }),
);
