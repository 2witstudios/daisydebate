import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock, IdGenerator } from '@daisy/clock';
import {
  createMessagingCoreSchemas,
  type MessagingCoreBounds,
} from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { planMessageSend } from './send-plan';
import { requireMessagingActor } from './principal';
import type { MessagingSendCommand } from '@daisy/db/messaging';

type MessagingSendStore = Pick<
  import('@daisy/db/messaging').MessagingChannelStore,
  'send'
>;
export type MessagingSendDependencies = {
  readonly bounds: MessagingCoreBounds;
  readonly store: MessagingSendStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly limit: (
    actorId: string,
    channelId: string,
    requestId: string,
  ) => Promise<void>;
};

/** Current authorization precedes protected replay, then one atomic send. */
export async function sendMessagingMessage(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: MessagingSendDependencies,
) {
  const { actorId, userId } = requireMessagingActor(principal);
  const { replyToMessageId, ...required } = parseValidated(
    createMessagingCoreSchemas(dependencies.bounds).send,
    input,
  );
  const command: MessagingSendCommand = {
    ...required,
    ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
  };
  const messageId = dependencies.ids.next();
  return dependencies.store.send({
    scope: { channelId: command.channelId, actorId, userId },
    command,
    admit: () =>
      dependencies.limit(actorId, command.channelId, command.requestId),
    decide: (state) =>
      planMessageSend(command, state, {
        actorId,
        messageId: state.receipt?.messageId ?? messageId,
        now: dependencies.clock.now(),
      }),
  });
}
