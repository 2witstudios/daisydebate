import { createHash } from 'node:crypto';
import { createAppError } from '@daisy/errors';
import { ticketSchema } from '@daisy/protocol';
import {
  runMemberRoute,
  type BudgetedMemberBoundary,
} from '../../server/member-boundary';

/** ADR 0031 §11 / plan section D: 60 s, single-use. */
const TICKET_TTL_SECONDS = 60;
/**
 * Enough for a tab reconnecting through a flaky network to keep getting
 * fresh tickets, far below what a ticket-mining abuse pattern would need.
 */
const TICKET_RULE = { windowSeconds: 60, max: 20 } as const;

type TicketDependencies = BudgetedMemberBoundary & {
  readonly websocketEndpoint: () => string | null;
  /** The caller's own durable session id, resolved from the same cookies. */
  readonly sessionId: (headers: Headers) => Promise<string | null>;
  readonly issueTicket: (input: {
    readonly ticketHash: string;
    readonly actorId: string;
    readonly sessionId: string;
    readonly origin: string;
    readonly ttlSeconds: number;
  }) => Promise<void>;
};

/**
 * 32 CSPRNG bytes, base64url-encoded: 43 characters, never a cuid2 (ADR
 * 0031 §11). Validated against the protocol's own `hello.ticket` shape so a
 * future change to either side turns this red rather than silently
 * diverging (the plan: "the protocol's hello schema ... reuse it").
 */
function randomTicket(): string {
  const ticket = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString('base64url');
  if (!ticketSchema.safeParse(ticket).success) throw createAppError('INTERNAL');
  return ticket;
}

const hashTicket = (ticket: string): string =>
  createHash('sha3-256').update(ticket).digest('hex');

/**
 * POST /api/realtime/ticket: the only way a browser obtains a realtime
 * connect ticket (ADR 0031 §11, plan section D). Gate order is ADR 0020:
 * route (same origin), Principal (session cookie), authorization (a
 * signed-in member), atomic rate limit, and only then the durable write.
 */
export function createTicketHandler(dependencies: TicketDependencies) {
  return (request: Request) =>
    // Signed in, but no username yet or no beta access (ADR 0075):
    // authenticated, not authorized, same as every other permission gate.
    runMemberRoute(
      dependencies,
      request,
      {
        name: 'realtime.ticket.issue',
        readOnly: false,
        bucket: 'realtime:ticket',
        rule: TICKET_RULE,
        beforeBudget: () => {
          if (dependencies.websocketEndpoint() === null)
            throw createAppError('INFRASTRUCTURE');
        },
      },
      async (caller) => {
        const socketUrl = dependencies.websocketEndpoint();
        const sessionId = await dependencies.sessionId(request.headers);
        // The session read that produced the identity just succeeded; a null
        // here means it lapsed in the instant between the two reads.
        if (!sessionId) throw createAppError('AUTHENTICATION');
        const ticket = randomTicket();
        const origin = new URL(dependencies.origin()).origin;
        await dependencies.issueTicket({
          ticketHash: hashTicket(ticket),
          actorId: caller.actorId,
          sessionId,
          origin,
          ttlSeconds: TICKET_TTL_SECONDS,
        });
        return Response.json({
          ticket,
          socketUrl,
          expiresInSeconds: TICKET_TTL_SECONDS,
        });
      },
    );
}
