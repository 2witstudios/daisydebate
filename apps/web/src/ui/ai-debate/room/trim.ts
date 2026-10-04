/** Quieter than this share of the clip's loudest moment counts as silence. */
const SILENCE = 0.02;
/** Window for measuring loudness, in milliseconds. */
const WINDOW_MS = 10;
/** Kept either side of the voice so no word is clipped, in milliseconds. */
const MARGIN_MS = 20;

/**
 * The sample range of a clip that holds its voice: the silence a voice
 * model pads before and after speech is cut, leaving a short margin, so
 * clips played back to back meet with only the pause we choose. A clip with
 * no voice in it is kept whole.
 */
export function voicedRange(
  samples: Float32Array,
  sampleRate: number,
): { readonly start: number; readonly end: number } {
  const window = Math.max(1, Math.round((sampleRate * WINDOW_MS) / 1000));
  const loudness: number[] = [];
  for (let at = 0; at < samples.length; at += window) {
    let sum = 0;
    const until = Math.min(samples.length, at + window);
    for (let index = at; index < until; index += 1)
      sum += samples[index]! * samples[index]!;
    loudness.push(Math.sqrt(sum / (until - at)));
  }
  const peak = Math.max(0, ...loudness);
  const voiced = loudness.map((level) => peak > 0 && level >= peak * SILENCE);
  const first = voiced.indexOf(true);
  if (first === -1) return { start: 0, end: samples.length };
  const last = voiced.lastIndexOf(true);
  const margin = Math.round((sampleRate * MARGIN_MS) / 1000);
  return {
    start: Math.max(0, first * window - margin),
    end: Math.min(samples.length, (last + 1) * window + margin),
  };
}
