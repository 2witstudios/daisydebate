import type { App } from '../../server/app';
import { identify } from '../../lib/identity';
import type { Identity } from '@daisy/auth';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Logger } from '@daisy/logger';
import { createAppError } from '@daisy/errors';
import { consumeWindowsOrThrow } from '../auth/abuse/rate-limit';
import {
  handleOperation,
  requireSameOrigin,
  requireSameOriginRead,
  requireSignedIn,
  readJson,
} from '../../server/http';
export type MessagingHandlerPort<T> = {
  readonly boundary: Boundary;
  readonly maxBodyBytes: number;
  readonly consume: (actorId: string) => Promise<void>;
  readonly store: (principal: AuthorizationPrincipal) => T;
};
/** Preferences and typing accept native channel scope only, never query-selected actor authority. */
export function readMessagingScope(
  request: Request,
  write: boolean,
  maxBodyBytes: number,
  channelId?: string,
) {
  if (write) return readJson(request, maxBodyBytes);
  if (new URL(request.url).search) throw createAppError('VALIDATION');
  return Promise.resolve({ version: 1, channelId });
}
type Boundary = {
  readonly logger: Logger;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
};
/** Two optional channel-metadata handlers share the same participant boundary and distinct explicit actor buckets. */
export function messagingActorHandlerPort(
  app: App,
  policy: NonNullable<App['messagingPolicy']>,
  bucket: 'typing' | 'preferences',
) {
  return {
    boundary: messagingHttpBoundary(app),
    maxBodyBytes: policy.maxBodyBytes,
    consume: (actorId: string) =>
      consumeWindowsOrThrow(
        app.auth().limiter,
        `messaging:${bucket}:${actorId}`,
        policy.limits.read,
      ),
  };
}
/** Message and social handlers use the same injected participant boundary. */
/** An identity whose principal the evaluator decides for: members and the waitlisted. */
export const evaluatedIdentity = (
  identity: Identity,
): identity is Extract<Identity, { state: 'member' | 'waitlisted' }> =>
  identity.state === 'member' || identity.state === 'waitlisted';

export function runMessagingHandler(
  boundary: Boundary,
  request: Request,
  input: {
    readonly name: string;
    readonly readOnly: boolean;
    readonly readInput: () => Promise<unknown>;
    readonly operation: (
      value: unknown,
      principal: AuthorizationPrincipal,
    ) => Promise<unknown>;
    readonly headers?: HeadersInit;
    readonly respond?: (value: unknown) => Response;
  },
) {
  return handleOperation(boundary.logger, request, input.name, async () => {
    if (input.readOnly) requireSameOriginRead(request, boundary.origin());
    else requireSameOrigin(request, boundary.origin());
    const identity = requireSignedIn(await boundary.identify(request));
    // A waitlisted account reaches the evaluator, the sole decision: it
    // keeps only its withdrawals there (ADR 0075).
    if (!evaluatedIdentity(identity)) throw createAppError('AUTHORIZATION');
    const value = await input.operation(
      await input.readInput(),
      identity.principal,
    );
    return input.respond
      ? input.respond(value)
      : Response.json(value, { headers: input.headers ?? {} });
  });
}

/** App-bound identity remains injected at the HTTP edge for each actual messaging route. */
export function messagingHttpBoundary(app: App): Boundary {
  return {
    logger: app.logger,
    origin: () => app.auth().config.PUBLIC_APP_URL,
    identify: (request) => identify(app.auth(), request.headers),
  };
}
export function unavailableMessagingHandler(
  app: App,
  request: Request,
  name = 'messaging.unavailable',
) {
  return handleOperation(app.logger, request, name, async () => {
    throw createAppError('INFRASTRUCTURE');
  });
}
