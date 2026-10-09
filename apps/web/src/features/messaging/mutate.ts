import { createHash } from 'node:crypto';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import type {
  MessagingChannelStore,
  MessagingMutationCommand,
  MessagingMutationState,
  MessagingMutationPlan,
} from '@daisy/db/messaging';
import { createAppError } from '@daisy/errors';
import {
  createMessagingCoreSchemas,
  type MessagingCoreBounds,
} from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { requireMessagingActor } from './principal';
import { planMessageMutation } from './mutation-plan';

const digest = (command: MessagingMutationCommand) =>
  createHash('sha3-256')
    .update(
      JSON.stringify([
        command.version,
        command.kind,
        command.messageId,
        command.kind === 'edit' ? command.text : null,
      ]),
    )
    .digest('hex');

function replay(
  command: MessagingMutationCommand,
  state: MessagingMutationState,
  actorId: string,
  payloadDigest: string,
) {
  if (!state.receipt) return null;
  if (
    !state.message ||
    state.message.text === null ||
    state.message.removedAt !== null ||
    state.message.authorActorId !== actorId
  )
    throw createAppError('NOT_FOUND');
  if (
    state.receipt.messageId !== command.messageId ||
    state.receipt.payloadDigest !== payloadDigest
  )
    throw createAppError('CONFLICT');
  return state.message;
}

export async function mutateMessagingMessage(
  kind: 'edit' | 'remove',
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: {
    readonly bounds: MessagingCoreBounds;
    readonly editWindowMs: number;
    readonly store: MessagingChannelStore;
    readonly clock: Clock;
    readonly limit: (actorId: string, channelId: string) => Promise<void>;
  },
) {
  const { actorId, userId } = requireMessagingActor(principal);
  const command = {
    ...parseValidated(
      createMessagingCoreSchemas(dependencies.bounds)[kind],
      input,
    ),
    kind,
  } as MessagingMutationCommand;
  const payloadDigest = digest(command);
  return dependencies.store.withChannel(
    { channelId: command.channelId, actorId, userId },
    async (frame) => {
      const state = await frame.readMutationState(command);
      const existing = replay(command, state, actorId, payloadDigest);
      if (existing) return existing;
      // Avoid consuming a limit for foreign/unavailable/expired author operations.
      const planAt = (current: MessagingMutationState) =>
        planMessageMutation(command, current.message, {
          actorId,
          now: dependencies.clock.now(),
          editWindowMs: dependencies.editWindowMs,
          changeVersion: current.counters.changeVersion,
        });
      planAt(state);
      await dependencies.limit(actorId, command.channelId);
      const plan = planAt(await frame.readMutationState(command));
      const mutation: MessagingMutationPlan = { ...plan, payloadDigest };
      await frame.commitMutation(mutation);
      return plan.message;
    },
  );
}
