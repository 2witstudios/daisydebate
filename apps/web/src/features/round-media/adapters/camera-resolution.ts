import { VideoPresets } from 'livekit-client';

/** Fewer cores than this do not encode a third layer beside a live Round. */
const CAPTURED_MIN_CORES = 4;

/**
 * What the camera captures, which is also the top simulcast layer. A captured Round,
 * for a Broadcast's stage or a debater's POV, adds 540p, and a browser that cannot say
 * it has the cores stays at the baseline: capture is never refused, and a POV says
 * which it got. A browser that runs short later drops the top layer itself.
 */
export const cameraResolution = (
  camera: 'standard' | 'captured',
  cores: number | undefined,
) =>
  camera === 'captured' && (cores ?? 0) >= CAPTURED_MIN_CORES
    ? VideoPresets.h540.resolution
    : VideoPresets.h360.resolution;
