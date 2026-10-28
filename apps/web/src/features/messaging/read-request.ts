import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { MessagingDmStore } from '@daisy/db/messaging';
import {
  createMessagingSocialSchemas,
  type MessagingSocialBounds,
} from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { requireMemberActor } from '../access/actor';

export async function readMessagingDmRequest(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: {
    readonly store: MessagingDmStore;
    readonly bounds: MessagingSocialBounds;
  },
) {
  const actor = requireMemberActor(principal);
  const command = parseValidated(
    createMessagingSocialSchemas(dependencies.bounds).previewDm,
    input,
  );
  return dependencies.store.readRequest({
    ...actor,
    channelId: command.channelId,
  });
}
