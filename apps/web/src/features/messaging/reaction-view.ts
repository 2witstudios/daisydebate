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
/** Shared counts from the snapshot; own flags from whichever arrived last,
 * the authorized HTTP read (which follows the viewer's own toggle) or a newer
 * overlay. `overlayAtRead` is the overlay that was current when the read
 * arrived; the read stands in entirely until the live window arrives. */
export function liveReactions(
  view: View,
  messageId: string,
  initial: readonly ReactionCount[],
  overlayAtRead: unknown,
):
  | { readonly kind: 'revoked' }
  | { readonly kind: 'removed' }
  | { readonly kind: 'list'; readonly items: readonly ReactionCount[] } {
  if (view.status === 'denied' || view.withdrawn) return { kind: 'revoked' };
  const message = view.content?.messages.find((item) => item.id === messageId);
  if (!message) return { kind: 'list', items: initial };
  if ('unavailable' in message) return { kind: 'removed' };
  const own = new Set(
    view.overlay === overlayAtRead
      ? initial.filter((item) => item.own).map((item) => item.reaction)
      : overlayReactions(view.overlay, messageId),
  );
  return {
    kind: 'list',
    items: message.reactions.map((item) => ({
      ...item,
      own: own.has(item.reaction),
    })),
  };
}
function overlayReactions(overlay: unknown, messageId: string) {
  const parsed = observationChannelOverlaySchema.safeParse(overlay, {
    jitless: true,
  });
  return parsed.success
    ? parsed.data.ownReactions
        .filter((item) => item.messageId === messageId)
        .map((item) => item.reaction)
    : [];
}
