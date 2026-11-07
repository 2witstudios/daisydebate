import { dispose } from '@livekit/rtc-node';

/** Process owner only: all native rooms must already be closed. */
export async function disposeAudioRuntime() {
  await dispose();
}
