import { officialFeedPath } from '@daisy/protocol';
import {
  audienceAdmits,
  type AudienceLinkFacts,
} from '../audience-link/audience-link';

export type OfficialFeedFacts = AudienceLinkFacts & {
  readonly feedKey: string;
  readonly stoppedAt: Date | null;
  readonly completedAt: Date | null;
};

/** The one address of a Broadcast's released media, for a player or a streamer. */
export const officialFeedUrl = (origin: string, feedKey: string): string =>
  new URL(officialFeedPath(feedKey), origin).href;

/** A Broadcast's public object tree: 256 CSPRNG bits, safe in a key and a URL. */
export const newFeedKey = (
  random: (bytes: number) => Uint8Array = (bytes) =>
    crypto.getRandomValues(new Uint8Array(bytes)),
): string => Buffer.from(random(32)).toString('base64url');

/**
 * The feed Stream this Round may offer this request, or null. Only an open
 * Broadcast this audience may reach: a private Round has none, an unlisted one
 * needs its current link, and a stopped or finished feed has ended.
 */
export const offeredFeedUrl = (
  origin: string | undefined,
  facts: OfficialFeedFacts | null,
  presentedHash: string | null,
): string | null =>
  origin !== undefined &&
  facts !== null &&
  audienceAdmits(facts, presentedHash) &&
  facts.stoppedAt === null &&
  facts.completedAt === null
    ? officialFeedUrl(origin, facts.feedKey)
    : null;
