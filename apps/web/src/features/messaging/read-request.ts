import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { MessagingDmStore } from '@daisy/db/messaging';
import {
  createMessagingSocialSchemas,
  type MessagingSocialBounds,
} from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { requireMessagingActor } from './principal';
export async function readMessagingDmRequest(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: {
    readonly store: MessagingDmStore;
    readonly bounds: MessagingSocialBounds;
  },
) {
  const actor = requireMessagingActor(principal);
  const command = parseValidated(
    createMessagingSocialSchemas(dependencies.bounds).previewDm,
    input,
  );
  return dependencies.store.withChannel(
    { ...actor, channelId: command.channelId },
    (frame) => frame.readRequest(),
  );
}
