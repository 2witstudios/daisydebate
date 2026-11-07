import { createAppError } from '@daisy/errors';
/** Pure native16kHz mono S16LE encoding. No energy/duration-based speech classification. */
export function encodePcmWave(frames: readonly Int16Array[]): Uint8Array {
  if (frames.length < 1 || frames.length > 6000)
    throw createAppError('VALIDATION', 'Invalid native PCM frames');
  for (const frame of frames)
    if (!(frame instanceof Int16Array) || frame.length !== 160)
      throw createAppError('VALIDATION', 'Invalid native PCM frames');
  const bytes = new Uint8Array(44 + frames.length * 320);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) =>
    bytes.set(new TextEncoder().encode(value), offset);
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, bytes.length - 44, true);
  let offset = 44;
  for (const frame of frames)
    for (const value of frame) {
      view.setInt16(offset, value, true);
      offset += 2;
    }
  return bytes;
}
