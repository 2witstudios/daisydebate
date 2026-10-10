import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { MessagingGroupManagementStore } from '@daisy/db/messaging';
import type { Clock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import {
  createMessagingSocialSchemas,
  messagingGroupCreationResultSchema,
  type MessagingSocialBounds,
} from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { requireMessagingActor } from './principal';
import { messagingSocialDigest } from './social-command-digest';
type Operation = 'remove' | 'leave' | 'transfer' | 'archive';
function managementCommand(
  operation: Operation,
  input: unknown,
  bounds: MessagingSocialBounds,
) {
  const schemas = createMessagingSocialSchemas(bounds);
  if (operation === 'remove') {
    const command = parseValidated(schemas.removeGroupMember, input);
    return { ...command, targetActorId: command.memberActorId };
  }
  if (operation === 'transfer') {
    const command = parseValidated(schemas.transferGroup, input);
    return { ...command, targetActorId: command.managerActorId };
  }
  return {
    ...parseValidated(
      operation === 'leave' ? schemas.leaveGroup : schemas.archiveGroup,
      input,
    ),
    targetActorId: undefined,
  };
}
export async function manageMessagingGroup(
  operation: Operation,
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: {
    readonly store: MessagingGroupManagementStore;
    readonly bounds: MessagingSocialBounds;
    readonly clock: Clock;
    readonly limit: (actorId: string) => Promise<void>;
  },
) {
  const actor = requireMessagingActor(principal);
  const command = managementCommand(operation, input, dependencies.bounds);
  const { targetActorId } = command;
  const digest = messagingSocialDigest(`group.${operation}`, [
    command.channelId,
    targetActorId ?? null,
  ]);
  return dependencies.store.withManagement(
    {
      ...actor,
      channelId: command.channelId,
      requestId: command.requestId,
      operation,
      ...(targetActorId === undefined ? {} : { targetActorId }),
    },
    async (frame) => {
      const state = await frame.readResult();
      if (state.receipt) {
        const receipt = state.receipt;
        if (
          receipt.actorId !== actor.actorId ||
          receipt.requestId !== command.requestId ||
          receipt.kind !== `group.${operation}` ||
          receipt.digest !== digest ||
          receipt.channelId !== command.channelId
        )
          throw createAppError('CONFLICT');
        return {
          version: 1 as const,
          channelId: command.channelId,
          lifecycle: state.lifecycle,
        };
      }
      await dependencies.limit(actor.actorId);
      const result = await frame.commit({
        digest,
        now: dependencies.clock.now(),
      });
      const parsed = messagingGroupCreationResultSchema.safeParse({
        version: 1,
        ...result,
      });
      if (!parsed.success || parsed.data.channelId !== command.channelId)
        throw createAppError('INFRASTRUCTURE');
      return parsed.data;
    },
  );
}
