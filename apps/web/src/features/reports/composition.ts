import { requireAuthorization } from '@daisy/auth/request-authorization';
import {
  moderationAcknowledgeSchema,
  reportCommandSchema,
  reportResultSchema,
} from '@daisy/protocol';
import { requireMemberActor } from '../access/actor';
import { appDiscoverActor } from '../account/username-discovery';
import { contactPairFence } from '../contacts/authorization';
import type { App } from '../../server/app';
import { parseValidated, readJson } from '../../server/http';
import {
  memberHttpBoundary,
  runMemberHandler,
} from '../../server/member-handler';
import { consumeOrThrow } from '../../server/rate-limit';
import { fileReport, REPORT_RULE } from './operations';

const MAX_BODY_BYTES = 1024;

/** Reports and the member's own moderation notices (ADR 0097). */
export function composeReportRoutes(app: App) {
  const boundary = memberHttpBoundary(app);
  return {
    file: (request: Request) =>
      runMemberHandler(boundary, request, {
        name: 'reports.file',
        readOnly: false,
        readInput: () => readJson(request, MAX_BODY_BYTES),
        operation: async (input, principal) => {
          const { username, reason, surface } = parseValidated(
            reportCommandSchema,
            input,
          );
          return reportResultSchema.parse({
            version: 1,
            ...(await fileReport(
              principal,
              { username, reason, surface },
              {
                clock: app.clock,
                ids: app.ids,
                limit: (actorId) =>
                  consumeOrThrow(app.limiter, `reports:${actorId}`, REPORT_RULE),
                discover: appDiscoverActor(app),
                store: () =>
                  app.database.reportStore(
                    contactPairFence({ principal, capability: 'social.report' }),
                  ),
              },
            )),
          });
        },
      }),
    notices: (request: Request) =>
      runMemberHandler(boundary, request, {
        name: 'reports.notices',
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
                  resource: { kind: 'friend_collection', actorId: scope.actorId },
                  context: { account },
                }),
            ),
          };
        },
        headers: { 'cache-control': 'no-store' },
      }),
    acknowledge: (request: Request) =>
      runMemberHandler(boundary, request, {
        name: 'reports.acknowledge',
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
                capability: 'social.moderation_notice.read',
                resource: { kind: 'friend_collection', actorId: scope.actorId },
                context: { account },
              }),
          );
          return { version: 1, id };
        },
      }),
  };
}
