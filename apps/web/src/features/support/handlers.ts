import type { Identity } from '@daisy/auth';
import type { SupportStore } from '@daisy/db/stores/support';
import { CLIENT_IP_HEADER } from '@daisy/ingress/client-ip';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { supportMessageSchema } from '@daisy/protocol/support-message';
import {
  handleOperation,
  parseValidated,
  readJson,
  requireSameOrigin,
} from '../../server/http';
import {
  consumeOrThrow,
  consumeWindowsOrThrow,
  type RateLimiter,
  type RateRule,
} from '../../server/rate-limit';

/**
 * One client's support messages: five an hour and twenty a day leave room
 * for a follow-up and stop a script. The ingress-stamped client address is
 * hashed into the key by the limiter and never logged; a request without
 * one shares a single bucket.
 */
export const supportClientRules: readonly RateRule[] = [
  { windowSeconds: 3_600, max: 5 },
  { windowSeconds: 86_400, max: 20 },
];
/**
 * One client's posts of any kind, resends included: bounds the lookups a
 * resend needs before the message allowance, far above what a person sends.
 */
export const supportProbeRule: RateRule = { windowSeconds: 3_600, max: 60 };
/**
 * Every client together: caps what rotating addresses can put in the
 * owner's inbox, set high enough above any real day of messages that a few
 * abusive clients cannot close the form to everyone else.
 */
export const supportEveryoneRule: RateRule = {
  windowSeconds: 86_400,
  max: 1_000,
};

/** Big enough for every field at its limit, with JSON escaping. */
const MAX_BODY_BYTES = 32_768;

/**
 * The account a message is recorded against: whoever is signed in, at any
 * stage of onboarding or under a restriction (support is where they ask
 * about it). A visitor, or a session store that cannot be read, sends as
 * nobody: support stays open either way.
 */
export const senderOf = (identity: Identity): string | null =>
  identity.principal.kind === 'user' ? identity.principal.userId : null;

/**
 * POST /api/support (SUPP-1): a support message, signed in or not. Same
 * origin only, and limited per client and for everyone before anything is
 * stored. The signed-in account comes from the session, never the body. A
 * resend of a message already stored unchanged answers the same without
 * spending any allowance, so a resend is safe.
 */
export const createSupportHandlers = (deps: {
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: () => RateLimiter;
  /** The id a changed resend is stored under: a stored message never changes. */
  readonly newId: () => string;
  readonly store: Pick<
    SupportStore,
    'supportMessageUnchanged' | 'recordSupportMessage'
  >;
}) => ({
  POST: (request: Request) =>
    handleOperation(
      deps.logger,
      request,
      'support.create',
      async () => {
        requireSameOrigin(request, deps.origin());
        const message = parseValidated(
          supportMessageSchema,
          await readJson(request, MAX_BODY_BYTES),
        );
        const client = request.headers.get(CLIENT_IP_HEADER) ?? 'unresolved';
        await consumeOrThrow(
          deps.limiter(),
          `support:probe:${client}`,
          supportProbeRule,
        );
        const memberUserId = senderOf(await deps.identify(request));
        if (await deps.store.supportMessageUnchanged(message, memberUserId))
          return Response.json({ received: true });
        await consumeWindowsOrThrow(
          deps.limiter(),
          `support:client:${client}`,
          supportClientRules,
        );
        await consumeOrThrow(
          deps.limiter(),
          'support:everyone',
          supportEveryoneRule,
        );
        await deps.store.recordSupportMessage({
          message,
          memberUserId,
          newId: deps.newId(),
        });
        return Response.json({ received: true });
      },
      deps.reporter,
    ),
});
