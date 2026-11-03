import type { AudienceSnapshot } from '@daisy/protocol';

const newestSequence = (snapshot: AudienceSnapshot) =>
  snapshot.messages.at(-1)?.sequence ?? 0;

/**
 * Which view to show. A shared read can be a second or two behind a fresh render,
 * so one that has not reached the newest message shown waits for the next read,
 * and a message never vanishes from the screen of the person who just posted it.
 */
export const newerAudience = (
  shown: AudienceSnapshot,
  incoming: AudienceSnapshot,
): AudienceSnapshot =>
  newestSequence(incoming) < newestSequence(shown) ? shown : incoming;
