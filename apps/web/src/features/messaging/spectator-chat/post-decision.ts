import type {
  MessagingSendCommand,
  MessagingSendState,
  SpectatorChannelFacts,
} from '@daisy/db/messaging';
import { createAppError, createRefusal } from '@daisy/errors';
import { decideChatPost } from '../../content-moderation/chat-post';
import { planMessageSend } from '../send-plan';

export const spectatorChatRefusals = [
  'chat-unavailable',
  'chat-closed',
  'chat-banned',
  'chat-slow-mode',
] as const;

/**
 * Whether this post may stand, and how it is written. Authority comes first, so
 * a ban or a closed account refuses a retry too; a retried request then replays,
 * so a slow-mode window never turns a lost answer into a refusal. Pure and total:
 * refusals leave state unchanged, because the caller's transaction rolls back.
 */
export const planSpectatorPost = (
  facts: SpectatorChannelFacts,
  state: MessagingSendState,
  command: MessagingSendCommand,
  resources: {
    readonly actorId: string;
    readonly messageId: string;
    readonly now: string;
  },
) => {
  const { account, broadcast } = facts;
  if (!account || account.erased || account.underThirteen)
    throw createAppError('AUTHORIZATION');
  if (account.restricted) throw createRefusal('CONFLICT', 'chat-banned');
  const nowMs = Date.parse(resources.now);
  const verdict = decideChatPost({
    banned: facts.banned,
    slowModeSeconds: broadcast?.slowModeSeconds ?? 0,
    lastPostAtMs: state.receipt ? null : facts.lastPostAtMs,
    nowMs,
  });
  if (verdict.kind === 'banned') throw createRefusal('CONFLICT', 'chat-banned');
  if (state.receipt) return planMessageSend(command, state, resources);
  if (!broadcast) throw createRefusal('CONFLICT', 'chat-unavailable');
  if (!broadcast.open) throw createRefusal('CONFLICT', 'chat-closed');
  if (verdict.kind === 'slow-mode')
    throw createRefusal('CONFLICT', 'chat-slow-mode');
  return planMessageSend(command, state, resources);
};
