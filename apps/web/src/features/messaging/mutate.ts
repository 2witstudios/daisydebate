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

import { planMessageMutation } from './mutation-plan';
import { requireMemberActor } from '../access/actor';

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
  const { actorId, userId } = requireMemberActor(principal);
  const command = {
    ...parseValidated(
      createMessagingCoreSchemas(dependencies.bounds)[kind],
      input,
    ),
    kind,
  } as MessagingMutationCommand;
  const payloadDigest = digest(command);
  const scope = { channelId: command.channelId, actorId, userId };
  const planAt = (current: MessagingMutationState) =>
    planMessageMutation(command, current.message, {
      actorId,
      now: dependencies.clock.now(),
      editWindowMs: dependencies.editWindowMs,
      changeVersion: current.counters.changeVersion,
    });
  // The lock-free preflight (MSG-2.2-arch1): a replay never spends the
  // limiter, and a foreign/unavailable/expired author operation refuses
  // before it; the limiter itself runs outside any database fence.
  const preflight = await dependencies.store.readChannel(scope, (frame) =>
    frame.readRequestState({
      requestId: command.requestId,
      messageId: command.messageId,
    }),
  );
  if (!replay(command, preflight, actorId, payloadDigest)) {
    planAt(preflight);
    await dependencies.limit(actorId, command.channelId);
  }
  return dependencies.store.withChannel(scope, async (frame) => {
    const state = await frame.readMutationState(command);
    const existing = replay(command, state, actorId, payloadDigest);
    if (existing) return existing;
    const plan = planAt(state);
    const mutation: MessagingMutationPlan = { ...plan, payloadDigest };
    await frame.commitMutation(mutation);
    return plan.message;
  });
}
