import { decodeLaunchEvidence } from './room-launch-evidence-decoder';
import { executeLaunchEvidence } from './launch-evidence-worker';

/** Node browser driver asks a Bun read-only process; no service URL is printed. */
export async function launchEvidence(roomId: string) {
  return decodeLaunchEvidence(
    await executeLaunchEvidence('room-launch-evidence-process.ts', roomId),
  );
}
