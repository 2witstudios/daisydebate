type View = {
  readonly status: string;
  readonly content: {
    readonly messages: readonly ({ readonly id: string } & object)[];
  } | null;
};
/** An in-progress edit is the user's own draft: it survives transport and
 * renewal gaps and ends only when access is denied or the message is gone. */
export function editVisibility(
  view: View,
  messageId: string,
): 'form' | 'removed' | 'revoked' {
  if (view.status === 'denied') return 'revoked';
  if (view.content === null) return 'form';
  const message = view.content.messages.find((item) => item.id === messageId);
  return !message || 'unavailable' in message ? 'removed' : 'form';
}
