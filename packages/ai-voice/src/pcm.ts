import { createAppError } from '@daisy/errors';

/** Aura-2's observed raw signed PCM16 little-endian envelope, not publication credit. */
export type PcmSpeech = {
  readonly pcm: Int16Array;
  readonly sampleRate: 24000;
  readonly channels: 1;
  readonly characters: number;
};
const MAX_BYTES = 24000 * 2 * 60;
export function requireSpeechNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted)
    throw createAppError('CONFLICT', 'Publication cancelled');
}
function validPcmMetadata(response: Response) {
  const [type, ...parameters] = (response.headers.get('content-type') ?? '')
    .toLowerCase()
    .split(';')
    .map((part) => part.trim());
  const metadata = new Map(
    parameters.map((part) => {
      const [key, value] = part.split('=');
      return [key, value];
    }),
  );
  return (
    type === 'audio/pcm' &&
    metadata.get('rate') === '24000' &&
    metadata.get('channels') === '1'
  );
}
async function pcmBytes(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      requireSpeechNotCancelled(signal);
      const next = await reader.read();
      requireSpeechNotCancelled(signal);
      if (next.done) break;
      length += next.value.length;
      if (length > MAX_BYTES)
        throw createAppError('INFRASTRUCTURE', 'Speech PCM exceeds one minute');
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  if (length === 0 || length % 2 !== 0)
    throw createAppError('INFRASTRUCTURE', 'Invalid speech PCM length');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
/** Validate provider metadata and bound memory before handing bytes to native media. */
export async function readPcmSpeech(
  response: Response,
  characters: number,
  signal?: AbortSignal,
): Promise<PcmSpeech> {
  if (!validPcmMetadata(response) || !response.body) {
    await response.body?.cancel();
    throw createAppError('INFRASTRUCTURE', 'Unsupported speech PCM envelope');
  }
  const bytes = await pcmBytes(response.body, signal);
  const view = new DataView(bytes.buffer);
  const pcm = new Int16Array(bytes.length / 2);
  for (let sample = 0; sample < pcm.length; sample++)
    pcm[sample] = view.getInt16(sample * 2, true);
  return { pcm, sampleRate: 24000, channels: 1, characters };
}
