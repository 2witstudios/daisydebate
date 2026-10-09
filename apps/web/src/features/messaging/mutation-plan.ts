import { createAppError } from '@daisy/errors';
import type { MessagingMessageRecord } from '@daisy/db/messaging';

type Mutation = {
  readonly channelId: string;
  readonly messageId: string;
} & (
  { readonly kind: 'edit'; readonly text: string } | { readonly kind: 'remove' }
);

/** Author checks supplement the current canonical channel authorization. */
export function planMessageMutation(
  command: Mutation,
  message: MessagingMessageRecord | null,
  resources: {
    readonly actorId: string;
    readonly now: string;
    readonly editWindowMs: number;
    readonly changeVersion: number;
  },
) {
  const available = requireAuthorMessage(command, message, resources.actorId);
  requireMutationTime(
    command.kind,
    available.createdAt,
    resources.now,
    resources.editWindowMs,
  );
  const changeVersion = resources.changeVersion + 1;
  if (
    !Number.isSafeInteger(changeVersion) ||
    changeVersion <= available.changeVersion
  )
    throw createAppError('CONFLICT');
  const updated: MessagingMessageRecord = {
    ...available,
    changeVersion,
    text: command.kind === 'edit' ? command.text : null,
    editedAt: command.kind === 'edit' ? resources.now : available.editedAt,
    removedAt: command.kind === 'remove' ? resources.now : null,
  };
  return {
    message: updated,
    doorbell: {
      kind: 'channel.changed' as const,
      channelId: command.channelId,
      changeVersion,
    },
  };
}

function requireAuthorMessage(
  command: Mutation,
  message: MessagingMessageRecord | null,
  actorId: string,
) {
  if (!message) throw createAppError('NOT_FOUND');
  if (
    ![
      message.id === command.messageId,
      message.channelId === command.channelId,
      message.text !== null,
      message.removedAt === null,
    ].every(Boolean)
  )
    throw createAppError('NOT_FOUND');
  if (message.authorActorId !== actorId) throw createAppError('AUTHORIZATION');
  return message;
}
function requireMutationTime(
  kind: Mutation['kind'],
  createdAt: string,
  timestamp: string,
  editWindowMs: number,
) {
  const now = Date.parse(timestamp),
    created = Date.parse(createdAt);
  if (
    ![Number.isFinite(now), Number.isFinite(created), now >= created].every(
      Boolean,
    )
  )
    throw createAppError('VALIDATION');
  if (
    kind === 'edit' &&
    ![
      Number.isSafeInteger(editWindowMs),
      editWindowMs > 0,
      now - created < editWindowMs,
    ].every(Boolean)
  )
    throw createAppError('AUTHORIZATION');
}
