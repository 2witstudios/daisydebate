/** Every Egress attempt of a Broadcast holds under this prefix, in the private bucket. */
export const broadcastHoldPrefix = (broadcastId: string): string =>
  `hold/${broadcastId}/`;
