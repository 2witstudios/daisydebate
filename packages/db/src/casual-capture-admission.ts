import { createRefusal } from '@daisy/errors';
import {
  NONRANKED_CAPTURE_FLEET_LIMIT,
  lockNonrankedCaptureCapacity,
  readNonrankedCaptureCapacity,
} from './nonranked-capture-capacity';
import type { Tx } from './tx';

/** One host's casual Rounds broadcast or recorded at once. */
export const CASUAL_CAPTURES_PER_HOST = 2;
/**
 * Casual Rounds broadcast or recorded at once, fleet-wide. Each takes one Egress, and
 * staging runs one machine fitting one Round, so a casual Round can hold it while a
 * ranked Round starts. A ranked Round is never refused: past the machine it runs
 * uncaptured, and the debate itself is never touched. Raise this with the machines
 * (deploy-staging, Adding capacity).
 */
export const CASUAL_CAPTURES_AT_ONCE = NONRANKED_CAPTURE_FLEET_LIMIT;

/**
 * Launch of a casual Round with capture admits it against both caps, or refuses by name
 * and starts nothing. Serialized fleet-wide, so concurrent Launches cannot both read
 * room for one. A running Round is never affected.
 */
export const admitCasualCapture = async (
  tx: Tx,
  input: { readonly hostActorId: string; readonly roundId: string },
): Promise<void> => {
  await lockNonrankedCaptureCapacity(tx);
  const counts = await readNonrankedCaptureCapacity(tx, {
    ...input,
    sponsorUserId: null,
    lobbyId: null,
  });
  if (counts.hosted >= CASUAL_CAPTURES_PER_HOST)
    throw createRefusal('CONFLICT', 'capture-host-limit');
  if (counts.running >= CASUAL_CAPTURES_AT_ONCE)
    throw createRefusal('CONFLICT', 'capture-capacity');
};
