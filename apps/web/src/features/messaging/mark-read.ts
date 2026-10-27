/** The read position a native form carried, if it is a valid sequence. */
export function formReadThrough(form: FormData): number | null {
  const value = form.get('readThrough');
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,15}$/.test(value))
    return null;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) ? sequence : null;
}

/** The read mutation's body: the cursor names the same channel it marks. */
export const messagingMarkReadBody = (channelId: string, sequence: number) => ({
  version: 1 as const,
  channelId,
  cursor: { channelId, sequence },
});

/** The fixed, value-free notice a refused native "Mark as read" returns with. */
export const markReadUnavailableNotice = 'read-unavailable';

/** Where the native "Mark as read" post returns: the conversation, noting a refusal. */
export const markReadDestination = (channelId: string, marked: boolean) =>
  marked
    ? `/messages/${channelId}`
    : `/messages/${channelId}?notice=${markReadUnavailableNotice}`;
