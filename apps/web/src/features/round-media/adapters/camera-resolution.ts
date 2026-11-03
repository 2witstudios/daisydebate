import { VideoPresets } from 'livekit-client';

/** Fewer cores than this do not encode a third layer beside a live Round. */
const BROADCAST_MIN_CORES = 4;

/**
 * What the camera captures, which is also the top simulcast layer. A Round with a
 * Broadcast adds 540p for the stage, and a browser that cannot say it has the cores
 * stays at the baseline. A browser that runs short later drops the top layer itself.
 */
export const cameraResolution = (
  camera: 'standard' | 'broadcast',
  cores: number | undefined,
) =>
  camera === 'broadcast' && (cores ?? 0) >= BROADCAST_MIN_CORES
    ? VideoPresets.h540.resolution
    : VideoPresets.h360.resolution;
