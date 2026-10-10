import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import type { App } from '../../server/app';
import { consumeOrThrow } from '../auth/abuse/rate-limit';
import { requestMessagingDm } from './request';
import { createMessagingGroup } from './create-group';
import { composeMessagingGroupCreationStore } from './group-creation-composition';
import { messagingSocialAuthorizationFence } from './social-authorization';
/** Actor-ID and username intent routes converge on these exact fenced operations. */
export function composeMessagingCreationOperation(
  app: App,
  kind: 'dm' | 'private_group',
) {
  return async (input: unknown, principal: AuthorizationPrincipal) => {
    const policy = app.messagingPolicy,
      social = policy?.social;
    if (!policy || !social) throw createAppError('INFRASTRUCTURE');
    const common = {
      bounds: social.bounds,
      clock: app.clock,
      ids: app.ids,
      limit: (actorId: string) =>
        consumeOrThrow(
          app.auth().limiter,
          `messaging:social:${actorId}`,
          social.abuse,
        ),
    };
    if (kind === 'dm') {
      if (social.creation.state !== 'approved')
        throw createAppError('INFRASTRUCTURE');
      return requestMessagingDm(input, principal, {
        ...common,
        store: app.database.messagingSocialStore(
          messagingSocialAuthorizationFence({
            principal,
            clock: app.clock,
            operation: { kind: 'dm', policy: social.creation },
          }),
        ),
        policyRevision: social.creation.revision,
        limits: social.requestLimits,
      });
    }
    return createMessagingGroup(input, principal, {
      ...common,
      store: composeMessagingGroupCreationStore({
        database: app.database,
        principal,
        clock: app.clock,
        postingPolicy: policy.posting,
        readingPolicy: policy.reading,
        ...(social.groupAdmission === undefined
          ? {}
          : { creationPolicy: social.groupAdmission }),
      }),
      ...(social.groupAdmission?.state === 'approved'
        ? { policyRevision: social.groupAdmission.revision }
        : {}),
    });
  };
}
