import type { SocialCreationPolicy } from '@daisy/auth/authorization';
import type { MessagingSocialBounds } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { App } from '../../server/app';
import { handleOperation } from '../../server/http';
import { identify } from '../../lib/identity';
import { consumeOrThrow } from '../auth/abuse/rate-limit';
import { createMessagingSocialHandlers } from './social-handlers';
import { composeMessagingDmStore } from './dm-composition';
import { messagingSocialAuthorizationFence } from './social-authorization';
import { requestMessagingDm } from './request';
import { decideMessagingDm } from './decide-request';
import { readMessagingDmRequest } from './read-request';
import { blockMessagingContact } from './block';
export type MessagingSocialRuntimePolicy = {
  readonly bounds: MessagingSocialBounds;
  readonly creation: SocialCreationPolicy;
  readonly requestLimits: {
    readonly windowMs: number;
    readonly maxNewPairs: number;
    readonly maxPending: number;
    readonly cooldownMs: number;
  };
  readonly abuse: { readonly max: number; readonly windowSeconds: number };
};

export function composeMessagingSocialRoutes(app: App) {
  const run = (
    request: Request,
    kind: 'request' | 'decide' | 'block' | 'preview',
    channelId?: string,
  ) => {
    const policy = app.messagingPolicy,
      social = policy?.social;
    if (!policy || !social)
      return handleOperation(
        app.logger,
        request,
        'messaging.unavailable',
        async () => {
          throw createAppError('INFRASTRUCTURE');
        },
      );
    const limit = (actorId: string) =>
      consumeOrThrow(
        app.auth().limiter,
        `messaging:social:${actorId}`,
        social.abuse,
      );
    const dm = (principal: Parameters<typeof requestMessagingDm>[1]) =>
      composeMessagingDmStore({
        database: app.database,
        principal,
        clock: app.clock,
        postingPolicy: policy.posting,
        readingPolicy: policy.reading,
      });
    const handlers = createMessagingSocialHandlers({
      logger: app.logger,
      origin: () => app.auth().config.PUBLIC_APP_URL,
      identify: (incoming) => identify(app.auth(), incoming.headers),
      maxBodyBytes: policy.maxBodyBytes,
      bounds: social.bounds,
      request: (input, principal) => {
        if (social.creation.state !== 'approved')
          throw createAppError('INFRASTRUCTURE');
        return requestMessagingDm(input, principal, {
          store: app.database.messagingSocialStore(
            messagingSocialAuthorizationFence({
              principal,
              clock: app.clock,
              operation: { kind: 'dm', policy: social.creation },
            }),
          ),
          bounds: social.bounds,
          clock: app.clock,
          ids: app.ids,
          policyRevision: social.creation.revision,
          limits: social.requestLimits,
          limit,
        });
      },
      decide: (input, principal) =>
        decideMessagingDm(input, principal, {
          store: dm(principal),
          bounds: social.bounds,
          clock: app.clock,
          limit,
        }),
      preview: (input, principal) =>
        readMessagingDmRequest(input, principal, {
          store: dm(principal),
          bounds: social.bounds,
        }),
      block: (input, principal) =>
        blockMessagingContact(input, principal, {
          bounds: social.bounds,
          clock: app.clock,
          limit,
          store: app.database.messagingSocialStore(
            messagingSocialAuthorizationFence({
              principal,
              clock: app.clock,
              operation: { kind: 'block' },
            }),
          ),
        }),
    });
    return kind === 'preview'
      ? handlers.preview(request, channelId!)
      : handlers[kind](request);
  };
  return {
    requestDm: (request: Request) => run(request, 'request'),
    decideDm: (request: Request) => run(request, 'decide'),
    blockContact: (request: Request) => run(request, 'block'),
    requestPreview: (request: Request, channelId: string) =>
      run(request, 'preview', channelId),
  };
}
