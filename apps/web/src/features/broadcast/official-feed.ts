import { officialFeedPath } from '@daisy/protocol';

export type OfficialFeedFacts = {
  readonly broadcastId: string;
  readonly roomVisibility: 'public' | 'unlisted' | 'private';
  readonly stoppedAt: Date | null;
  readonly completedAt: Date | null;
};

/** The one address of a Broadcast's released media, for a player or a streamer. */
export const officialFeedUrl = (origin: string, broadcastId: string): string =>
  new URL(officialFeedPath(broadcastId), origin).href;

/**
 * The feed Stream this Round may offer, or null. Only a public Room's open
 * Broadcast: a private Round has none, a stopped or finished feed has ended, and
 * an unlisted one stays closed until its keys sit under an unguessable prefix.
 */
export const offeredFeedUrl = (
  origin: string | undefined,
  facts: OfficialFeedFacts | null,
): string | null =>
  origin !== undefined &&
  facts !== null &&
  facts.roomVisibility === 'public' &&
  facts.stoppedAt === null &&
  facts.completedAt === null
    ? officialFeedUrl(origin, facts.broadcastId)
    : null;
