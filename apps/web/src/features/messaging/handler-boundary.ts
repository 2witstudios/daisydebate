import type { App } from '../../server/app';
import { identify } from '../../lib/identity';
import type { Identity } from '@daisy/auth';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Logger } from '@daisy/logger';
import { createAppError } from '@daisy/errors';
import {
  handleOperation,
  requireSameOrigin,
  requireSameOriginRead,
  requireSignedIn,
} from '../../server/http';
type Boundary = {
  readonly logger: Logger;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
};
/** Message and social handlers use the same injected participant boundary. */
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
    if (identity.state !== 'member') throw createAppError('AUTHORIZATION');
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
