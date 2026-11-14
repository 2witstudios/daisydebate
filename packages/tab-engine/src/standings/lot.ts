import {
  compareBytes,
  shuffleWith,
  utf8,
  wordStream,
} from '@daisy/seeded-random';
import type { Id } from '../shapes/competition';

/**
 * A seeded lot over one tied group. The stream's prefix is the group itself
 * (its ids in canonical order), so a group's lot depends on who is in it and
 * the seed, never on the order the caller listed anyone or on other groups.
 */
export const drawLots = (
  domain: string,
  seed: Uint8Array,
  ids: readonly Id[],
): Id[] => {
  const canonical = [...ids].sort(compareBytes);
  return shuffleWith(
    canonical,
    wordStream(domain, seed, utf8(canonical.join('\u0000'))),
  );
};
