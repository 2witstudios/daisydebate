import { createAppError } from '@daisy/errors';
import { createMessagingSocialSchemas } from '@daisy/protocol';
import type { App } from '../../server/app';
import { parseValidated, readJson } from '../../server/http';
import { consumeOrThrow } from '../auth/abuse/rate-limit';
import {
  runMessagingHandler,
  messagingHttpBoundary,
  unavailableMessagingHandler,
} from './handler-boundary';
import { composeMessagingGroupInvitationStore } from './group-invitation-composition';
import {
  readMessagingGroupInvitation,
  decideMessagingGroupInvitation,
} from './group-invitation';
/** Refusal and minimal reads do not depend on group admission approval. */
export function composeMessagingGroupInvitationRoutes(app: App) {
  const run = (
    request: Request,
    mode: 'read' | 'decide' | 'cancel',
    channelId?: string,
  ) => {
    const policy = app.messagingPolicy,
      social = policy?.social;
    if (!policy || !social) return unavailableMessagingHandler(app, request);
    return runMessagingHandler(messagingHttpBoundary(app), request, {
      name: `messaging.invitation.${mode}`,
      readOnly: mode === 'read',
      readInput:
        mode === 'read'
          ? async () => ({ version: 1, channelId })
          : () => readJson(request, policy.maxBodyBytes),
      operation: async (input, principal) => {
        if (mode === 'decide') {
          const command = parseValidated(
            createMessagingSocialSchemas(social.bounds).decideGroupInvitation,
            input,
          );
          if (
            command.decision === 'accept' &&
            social.groupAdmission?.state !== 'approved'
          )
            throw createAppError('INFRASTRUCTURE');
        }
        const dependencies = {
          store: composeMessagingGroupInvitationStore({
            database: app.database,
            principal,
            clock: app.clock,
            ...(social.groupAdmission === undefined
              ? {}
              : { admissionPolicy: social.groupAdmission }),
          }),
          bounds: social.bounds,
          clock: app.clock,
          limit: (actorId: string) =>
            consumeOrThrow(
              app.auth().limiter,
              `messaging:social:${actorId}`,
              social.abuse,
            ),
        };
        const result =
          mode === 'read'
            ? await readMessagingGroupInvitation(input, principal, dependencies)
            : await decideMessagingGroupInvitation(
                mode,
                input,
                principal,
                dependencies,
              );
        return { version: 1, ...result };
      },
    });
  };
  return {
    groupInvitation: (request: Request, channelId: string) =>
      run(request, 'read', channelId),
    decideGroupInvitation: (request: Request) => run(request, 'decide'),
    cancelGroupInvitation: (request: Request) => run(request, 'cancel'),
  };
}
