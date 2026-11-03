import { createHash } from 'node:crypto';

/**
 * The key a Round's published state lives under: its feed key and, on an unlisted
 * Round, its current link. Replacing the link moves the state, so the old link's
 * holder has no address for what happens next (ADR 0109).
 */
export const audienceStateKey = (
  feedKey: string,
  linkHash: string | null,
): string =>
  createHash('sha3-256')
    .update(`${feedKey}:${linkHash ?? 'public'}`)
    .digest('hex');
