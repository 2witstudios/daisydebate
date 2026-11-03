import { officialFeedPath } from '@daisy/protocol';

/** The one address of a Broadcast's released media, for a player or a streamer. */
export const officialFeedUrl = (origin: string, feedKey: string): string =>
  new URL(officialFeedPath(feedKey), origin).href;

/** A Broadcast's public object tree: 256 CSPRNG bits, safe in a key and a URL. */
export const newFeedKey = (
  random: (bytes: number) => Uint8Array = (bytes) =>
    crypto.getRandomValues(new Uint8Array(bytes)),
): string => Buffer.from(random(32)).toString('base64url');
