import type { Track, RemoteTrack, LocalAudioTrack } from '@livekit/rtc-node';

/** Public require-condition types must match the installed prototype and inherited aliases. */
export const observe = (
  track: Track,
  remote: RemoteTrack,
  local: LocalAudioTrack,
  signal: AbortSignal,
) =>
  Promise.all([
    track.getStats({ signal, timeoutMs: 1000 }),
    remote.getStats({ signal, timeoutMs: 1000 }),
    local.getStats({ signal, timeoutMs: 1000 }),
  ]);
