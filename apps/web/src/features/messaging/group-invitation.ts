import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import type { MessagingGroupInvitationStore } from '@daisy/db/messaging';
import { createAppError } from '@daisy/errors';
import {
  createMessagingSocialSchemas,
  type MessagingSocialBounds,
} from '@daisy/protocol';
import { requireMessagingActor } from './principal';
import { parseValidated } from '../../server/http';
import { messagingSocialDigest } from './social-command-digest';
type Dependencies = {
  readonly store: MessagingGroupInvitationStore;
  readonly bounds: MessagingSocialBounds;
  readonly clock: Clock;
  readonly limit: (actorId: string) => Promise<void>;
};
const outcomes = {
  accept: 'accepted',
  decline: 'declined',
  cancel: 'cancelled',
} as const;
export function readMessagingGroupInvitation(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: Pick<Dependencies, 'store' | 'bounds'>,
) {
  const actor = requireMessagingActor(principal);
  const command = parseValidated(
    createMessagingSocialSchemas(dependencies.bounds).readGroupInvitation,
    input,
  );
  return dependencies.store.withInvitation(
    {
      ...actor,
      channelId: command.channelId,
      inviteeActorId: actor.actorId,
      operation: 'read',
    },
    async (frame) =>
      minimalInvitationResult(
        await frame.preview(),
        command.channelId,
        dependencies.bounds,
      ),
  );
}
/** The original operation/generation/actual counterpart bind closed own receipt replay. */
export async function decideMessagingGroupInvitation(
  kind: 'decide' | 'cancel',
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: Dependencies,
) {
  const actor = requireMessagingActor(principal);
  const schemas = createMessagingSocialSchemas(dependencies.bounds);
  const command =
    kind === 'cancel'
      ? parseValidated(schemas.cancelGroupInvitation, input)
      : parseValidated(schemas.decideGroupInvitation, input);
  const decision = 'decision' in command ? command.decision : 'cancel';
  const inviteeActorId =
    'inviteeActorId' in command ? command.inviteeActorId : actor.actorId;
  const digest = messagingSocialDigest('group.invitation.decide', [
    command.channelId,
    inviteeActorId,
    command.expectedGeneration,
    decision,
  ]);
  return dependencies.store.withInvitation(
    {
      ...actor,
      channelId: command.channelId,
      inviteeActorId,
      expectedGeneration: command.expectedGeneration,
      operation: decision,
    },
    async (frame) => {
      const state = await frame.readDecisionState(command.requestId, decision);
      if (state.generation !== command.expectedGeneration)
        throw createAppError('CONFLICT');
      const replay = invitationReplay(state, {
        channelId: command.channelId,
        digest,
        inviteeActorId,
        decision,
      });
      if (replay) return replay;
      if (state.state !== 'pending') throw createAppError('AUTHORIZATION');
      await dependencies.limit(actor.actorId);
      const now = dependencies.clock.now();
      if (
        !Number.isFinite(Date.parse(now)) ||
        Date.parse(now) < Date.parse(state.invitedAt)
      )
        throw createAppError('VALIDATION');
      return minimalInvitationResult(
        await frame.commitDecision({
          requestId: command.requestId,
          decision,
          digest,
          now,
        }),
        command.channelId,
        dependencies.bounds,
      );
    },
  );
}

type InvitationFrame = Parameters<
  Parameters<MessagingGroupInvitationStore['withInvitation']>[1]
>[0];
function invitationReplay(
  state: Awaited<ReturnType<InvitationFrame['readDecisionState']>>,
  expected: {
    readonly channelId: string;
    readonly digest: string;
    readonly inviteeActorId: string;
    readonly decision: keyof typeof outcomes;
  },
) {
  const receipt = state.receipt;
  if (!receipt) return null;
  if (state.state === 'pending') throw createAppError('AUTHORIZATION');
  const counterpart =
    expected.decision === 'cancel'
      ? expected.inviteeActorId
      : state.inviterActorId;
  if (
    receipt.kind !== 'group.decide' ||
    receipt.digest !== expected.digest ||
    receipt.channelId !== expected.channelId ||
    receipt.counterpartActorId !== counterpart ||
    state.state !== outcomes[expected.decision]
  )
    throw createAppError('CONFLICT');
  return {
    channelId: expected.channelId,
    generation: state.generation,
    state: outcomes[expected.decision],
  };
}

function minimalInvitationResult(
  input: unknown,
  channelId: string,
  bounds: MessagingSocialBounds,
) {
  if (typeof input !== 'object' || input === null)
    throw createAppError('INFRASTRUCTURE');
  const result = createMessagingSocialSchemas(
    bounds,
  ).invitationResult.safeParse({ ...input, version: 1 });
  if (!result.success || result.data.channelId !== channelId)
    throw createAppError('INFRASTRUCTURE');
  return {
    channelId: result.data.channelId,
    generation: result.data.generation,
    state: result.data.state,
  };
}
