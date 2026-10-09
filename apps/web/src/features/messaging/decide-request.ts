import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import type { MessagingDmStore } from '@daisy/db/messaging';
import { createAppError } from '@daisy/errors';
import {
  createMessagingSocialSchemas,
  type MessagingSocialBounds,
} from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { requireMessagingActor } from './principal';
import { messagingSocialDigest } from './social-command-digest';
const resultStates = {
  accept: 'accepted',
  decline: 'declined',
  cancel: 'cancelled',
} as const;

/** Closed result authority is only an own bound receipt projection, never another write. */
export async function decideMessagingDm(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: {
    readonly store: MessagingDmStore;
    readonly bounds: MessagingSocialBounds;
    readonly clock: Clock;
    readonly limit: (actorId: string) => Promise<void>;
  },
) {
  const { actorId, userId } = requireMessagingActor(principal);
  const command = parseValidated(
    createMessagingSocialSchemas(dependencies.bounds).decideDm,
    input,
  );
  const digest = messagingSocialDigest('dm.decide', [
    command.channelId,
    command.decision,
  ]);
  return dependencies.store.withChannel(
    { actorId, userId, channelId: command.channelId },
    async (frame) => {
      const state = await frame.readDecisionState(command);
      const replay = replayDecision(command, state, digest);
      if (replay) return replay;
      if (state.state !== 'pending') throw createAppError('AUTHORIZATION');
      await dependencies.limit(actorId);
      const now = dependencies.clock.now();
      if (
        !Number.isFinite(Date.parse(now)) ||
        Date.parse(now) < Date.parse(state.requestedAt)
      )
        throw createAppError('VALIDATION');
      return frame.commitDecision({ ...command, digest, now });
    },
  );
}

type DecisionFrame = Parameters<
  Parameters<MessagingDmStore['withChannel']>[1]
>[0];
function replayDecision(
  command: {
    readonly channelId: string;
    readonly decision: keyof typeof resultStates;
  },
  state: Awaited<ReturnType<DecisionFrame['readDecisionState']>>,
  digest: string,
) {
  if (!state.receipt) return null;
  if (state.state === 'pending') throw createAppError('AUTHORIZATION');
  const receipt = state.receipt;
  if (
    receipt.kind !== 'dm.decide' ||
    receipt.digest !== digest ||
    receipt.channelId !== command.channelId
  )
    throw createAppError('CONFLICT');
  return {
    channelId: command.channelId,
    state: resultStates[command.decision],
  };
}
