import { observationChannelOverlaySchema } from '@daisy/protocol';

export type ReactionCount = {
  readonly reaction: string;
  readonly count: number;
  readonly own: boolean;
};
type Message =
  | {
      readonly id: string;
      readonly reactions: readonly { reaction: string; count: number }[];
    }
  | { readonly id: string; readonly unavailable: true };
type View = {
  readonly status: string;
  readonly withdrawn: boolean;
  readonly overlay?: unknown;
  readonly content: { readonly messages: readonly Message[] } | null;
};
/** Shared counts from the snapshot, own flags from this viewer's overlay;
 * the authorized HTTP read stands in until the live window arrives. */
export function liveReactions(
  view: View,
  messageId: string,
  initial: readonly ReactionCount[],
):
  | { readonly kind: 'revoked' }
  | { readonly kind: 'removed' }
  | { readonly kind: 'list'; readonly items: readonly ReactionCount[] } {
  if (view.status === 'denied' || view.withdrawn) return { kind: 'revoked' };
  const message = view.content?.messages.find((item) => item.id === messageId);
  if (!message) return { kind: 'list', items: initial };
  if ('unavailable' in message) return { kind: 'removed' };
  const overlay = observationChannelOverlaySchema.safeParse(view.overlay, {
    jitless: true,
  });
  const own = new Set(
    overlay.success
      ? overlay.data.ownReactions
          .filter((item) => item.messageId === messageId)
          .map((item) => item.reaction)
      : [],
  );
  return {
    kind: 'list',
    items: message.reactions.map((item) => ({
      ...item,
      own: own.has(item.reaction),
    })),
  };
}
