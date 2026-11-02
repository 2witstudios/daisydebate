import { requireAuthorization } from '@daisy/auth/request-authorization';
import { moderationAcknowledgeSchema } from '@daisy/protocol';
import { requireMemberActor } from '../access/actor';
import type { App } from '../../server/app';
import { parseValidated, readJson } from '../../server/http';
import {
  memberHttpBoundary,
  runMemberHandler,
} from '../../server/member-handler';

const MAX_BODY_BYTES = 1024;

/** The member's own moderation notices (ADR 0098). */
export function composeModerationRoutes(app: App) {
  const boundary = memberHttpBoundary(app);
  return {
    notices: (request: Request) =>
      runMemberHandler(boundary, request, {
        name: 'moderation.notices',
        readOnly: true,
        readInput: async () => null,
        operation: async (_input, principal) => {
          const { actorId, userId } = requireMemberActor(principal);
          return {
            notices: await app.database.listModerationNotices(
              { userId, actorId },
              async ({ scope, account }) =>
                requireAuthorization({
                  principal,
                  capability: 'social.moderation_notice.read',
                  resource: {
                    kind: 'moderation_notice',
                    actorId: scope.actorId,
                  },
                  context: { account },
                }),
            ),
          };
        },
        headers: { 'cache-control': 'no-store' },
      }),
    acknowledge: (request: Request) =>
      runMemberHandler(boundary, request, {
        name: 'moderation.acknowledge',
        readOnly: false,
        readInput: () => readJson(request, MAX_BODY_BYTES),
        operation: async (input, principal) => {
          const { actorId, userId } = requireMemberActor(principal);
          const { id } = parseValidated(moderationAcknowledgeSchema, input);
          await app.database.acknowledgeModerationNotice(
            { userId, actorId },
            { id, now: app.clock.now() },
            async ({ scope, account }) =>
              requireAuthorization({
                principal,
                capability: 'social.moderation_notice.acknowledge',
                resource: { kind: 'moderation_notice', actorId: scope.actorId },
                context: { account },
              }),
          );
          return { version: 1, id };
        },
      }),
  };
}
