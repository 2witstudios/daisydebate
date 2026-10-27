/** The read mutation's body: the cursor names the same channel it marks. */
export const messagingMarkReadBody = (channelId: string, sequence: number) => ({
  version: 1 as const,
  channelId,
  cursor: { channelId, sequence },
});
