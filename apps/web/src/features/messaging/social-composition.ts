import { composeMessagingInbox } from './inbox-composition';
import type { SocialCreationPolicy } from '@daisy/auth/authorization';
import {
  createMessagingSocialSchemas,
  type MessagingSocialBounds,
} from '@daisy/protocol';
import type { App } from '../../server/app';
import { parseValidated } from '../../server/http';
import { consumeWindowsOrThrow, type RateRule } from '../../server/rate-limit';
import { createMessagingSocialHandlers } from './social-handlers';
import { composeMessagingDmStore } from './dm-composition';
import { requestMessagingDm } from './request';
import { composeMessagingCreationOperation } from './creation-operation';
import { decideMessagingDm } from './decide-request';
import { readMessagingDmRequest } from './read-request';
import { memberHttpBoundary } from '../../server/member-handler';
export type MessagingSocialRuntimePolicy = {
  readonly bounds: MessagingSocialBounds;
  readonly creation: SocialCreationPolicy;
  readonly groupAdmission?: SocialCreationPolicy;
  readonly groupInvitationLimits?: {
    readonly maxMembers: number;
    readonly maxPendingInvitations: number;
  };
  /** Per-account ceiling on every social command. */
  readonly abuse: readonly RateRule[];
};

export function composeMessagingSocialRoutes(app: App) {
  const run = (
    request: Request,
    kind: 'request' | 'decide' | 'preview' | 'status',
    channelId?: string,
  ) => {
    const policy = app.messagingPolicy,
      social = policy.social;
    const limit = (actorId: string) =>
      consumeWindowsOrThrow(
        app.limiter,
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
      ...memberHttpBoundary(app),
      maxBodyBytes: policy.maxBodyBytes,
      bounds: social.bounds,
      request: composeMessagingCreationOperation(app, 'dm'),
      decide: (input, principal) =>
        decideMessagingDm(input, principal, {
          store: dm(principal),
          bounds: social.bounds,
          clock: app.clock,
          limit,
          limits: app.contactsPolicy.requests,
        }),
      status: (input, principal) => {
        const command = parseValidated(
          createMessagingSocialSchemas(social.bounds).previewDm,
          input,
        );
        return composeMessagingInbox({
          database: app.database,
          principal,
          clock: app.clock,
          postingPolicy: policy.posting,
          readingPolicy: policy.reading,
        }).status(command.channelId);
      },
      preview: (input, principal) =>
        readMessagingDmRequest(input, principal, {
          store: dm(principal),
          bounds: social.bounds,
        }),
    });
    return kind === 'preview' || kind === 'status'
      ? handlers[kind](request, channelId!)
      : handlers[kind](request);
  };
  return {
    requestStatus: (request: Request, channelId: string) =>
      run(request, 'status', channelId),
    requestDm: (request: Request) => run(request, 'request'),
    decideDm: (request: Request) => run(request, 'decide'),
    requestPreview: (request: Request, channelId: string) =>
      run(request, 'preview', channelId),
  };
}
