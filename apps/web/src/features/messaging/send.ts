import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock, IdGenerator } from '@daisy/clock';
import {
  createMessagingCoreSchemas,
  type MessagingCoreBounds,
} from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { planMessageSend } from './send-plan';

import type {
  MessagingCreateSendPlan,
  MessagingReadFrame,
  MessagingSendCommand,
  MessagingSendState,
} from '@daisy/db/messaging';
import { requireMemberActor } from '../access/actor';

type MessagingSendFrame = {
  readonly authorize: () => Promise<void>;
  readonly readSendState: (
    command: MessagingSendCommand,
  ) => Promise<MessagingSendState>;
  readonly commitSend: (plan: MessagingCreateSendPlan) => Promise<void>;
};
type ChannelScope = {
  readonly channelId: string;
  readonly actorId: string;
  readonly userId: string;
};
type MessagingSendStore = {
  readonly readChannel: <T>(
    input: ChannelScope,
    work: (frame: Pick<MessagingReadFrame, 'readRequestState'>) => Promise<T>,
  ) => Promise<T>;
  readonly withChannel: <T>(
    input: ChannelScope,
    work: (frame: MessagingSendFrame) => Promise<T>,
  ) => Promise<T>;
};
export type MessagingSendDependencies = {
  readonly bounds: MessagingCoreBounds;
  readonly store: MessagingSendStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly limit: (actorId: string, channelId: string) => Promise<void>;
};

/**
 * Current authorization precedes protected replay, then one atomic send. The
 * limiter runs before the transaction, never inside a database fence, and
 * only for a request key with no receipt, so a same-key replay never spends
 * it (MSG-2.2-arch1).
 */
export async function sendMessagingMessage(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: MessagingSendDependencies,
) {
  const { actorId, userId } = requireMemberActor(principal);
  const { replyToMessageId, ...required } = parseValidated(
    createMessagingCoreSchemas(dependencies.bounds).send,
    input,
  );
  const command: MessagingSendCommand = {
    ...required,
    ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
  };
  const scope = { channelId: command.channelId, actorId, userId };
  const preflight = await dependencies.store.readChannel(scope, (frame) =>
    frame.readRequestState({ requestId: command.requestId }),
  );
  if (!preflight.receipt) await dependencies.limit(actorId, command.channelId);
  return dependencies.store.withChannel(scope, async (frame) => {
    await frame.authorize();
    const state = await frame.readSendState(command);
    const plan = planMessageSend(command, state, {
      actorId,
      messageId: state.receipt?.messageId ?? dependencies.ids.next(),
      now: dependencies.clock.now(),
    });
    if (plan.kind === 'create') await frame.commitSend(plan);
    return plan.message;
  });
}
