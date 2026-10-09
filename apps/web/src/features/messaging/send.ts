import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock, IdGenerator } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import {
  createMessagingCoreSchemas,
  type MessagingCoreBounds,
} from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { planMessageSend } from './send-plan';
import type {
  MessagingSendCommand,
  MessagingSendState,
} from '@daisy/db/messaging';

export type MessagingCreateSendPlan = Extract<
  ReturnType<typeof planMessageSend>,
  { kind: 'create' }
>;
export type MessagingSendFrame = {
  readonly authorize: () => Promise<void>;
  readonly readSendState: (
    command: MessagingSendCommand,
  ) => Promise<MessagingSendState>;
  readonly commitSend: (plan: MessagingCreateSendPlan) => Promise<void>;
};
export type MessagingSendStore = {
  readonly withChannel: <T>(
    input: {
      readonly channelId: string;
      readonly actorId: string;
      readonly userId: string;
    },
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

/** Current authorization precedes protected replay, then one atomic send. */
export async function sendMessagingMessage(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: MessagingSendDependencies,
) {
  if (principal.kind === 'anonymous') throw createAppError('AUTHENTICATION');
  if (principal.kind !== 'user') throw createAppError('AUTHORIZATION');
  if (principal.actorId === null) throw createAppError('AUTHORIZATION');
  const actorId = principal.actorId;
  const { replyToMessageId, ...required } = parseValidated(
    createMessagingCoreSchemas(dependencies.bounds).send,
    input,
  );
  const command: MessagingSendCommand = {
    ...required,
    ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
  };
  return dependencies.store.withChannel(
    { channelId: command.channelId, actorId, userId: principal.userId },
    async (frame) => {
      await frame.authorize();
      const state = await frame.readSendState(command);
      const plan = planMessageSend(command, state, {
        actorId,
        messageId: state.receipt?.messageId ?? dependencies.ids.next(),
        now: dependencies.clock.now(),
      });
      if (plan.kind === 'create') {
        await dependencies.limit(actorId, command.channelId);
        await frame.commitSend(plan);
      }
      return plan.message;
    },
  );
}
