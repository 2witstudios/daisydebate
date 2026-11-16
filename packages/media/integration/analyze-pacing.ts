/** Analyze retained synthetic native PCM; never treats callback gaps as audio gaps. */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.argv[2];
if (!directory)
  throw new Error('Usage: analyze-pacing.ts <observation directory>');
const readPcm = async (name: string) => {
  const bytes = await readFile(join(directory, name));
  return Float64Array.from(
    new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2),
  );
};
for (const phase of ['on-time', 'initial-fill', 'established-lead']) {
  const source = await readPcm(`${phase}-source.pcm`);
  const received = await readPcm(`${phase}-received.pcm`);
  const width = 480; // 20ms windows, at 10ms source strides.
  const energy = new Float64Array(received.length + 1);
  for (let index = 0; index < received.length; index += 1)
    energy[index + 1] = energy[index]! + received[index]! ** 2;
  let lag = 0;
  const alignment: {
    sourceMs: number;
    receivedMs: number;
    lagMs: number;
    correlation: number;
  }[] = [];
  for (let start = 0; start <= source.length - width; start += 240) {
    let sourceEnergy = 0;
    for (let index = 0; index < width; index += 1)
      sourceEnergy += source[start + index]! ** 2;
    let best = -Infinity;
    let position = 0;
    // First window: global alignment. Later: ±40ms around the preceding lag.
    const low = start === 0 ? 0 : Math.max(0, start + lag - 960);
    const high =
      start === 0
        ? received.length - width
        : Math.min(received.length - width, start + lag + 960);
    for (let candidate = low; candidate <= high; candidate += 1) {
      let product = 0;
      for (let index = 0; index < width; index += 1)
        product += source[start + index]! * received[candidate + index]!;
      const score =
        product /
        Math.sqrt(
          Math.max(
            1,
            sourceEnergy * (energy[candidate + width]! - energy[candidate]!),
          ),
        );
      if (score > best) {
        best = score;
        position = candidate;
      }
    }
    lag = position - start;
    alignment.push({
      sourceMs: start / 24,
      receivedMs: position / 24,
      lagMs: lag / 24,
      correlation: best,
    });
  }
  const received10msRms = Array.from(
    { length: Math.floor(received.length / 240) },
    (_, index) => ({
      receivedMs: index * 10,
      rms: Math.sqrt((energy[(index + 1) * 240]! - energy[index * 240]!) / 240),
    }),
  );
  const jumps = alignment.flatMap((point, index) => {
    const previous = alignment[index - 1];
    return previous && Math.abs(point.lagMs - previous.lagMs) > 3
      ? [
          {
            sourceMs: point.sourceMs,
            lagChangeMs: point.lagMs - previous.lagMs,
          },
        ]
      : [];
  });
  await writeFile(
    join(directory, `${phase}-alignment.json`),
    JSON.stringify(
      {
        method:
          '20ms normalized broadband correlation, 10ms source strides; first window global, subsequent search ±40ms around previous lag. Observations, not a codec-independent PASS threshold. Inspect all jumps, startup and tail separately.',
        alignment,
        received10msRms,
        jumps,
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    JSON.stringify({
      phase,
      jumps,
      minimumCorrelation: Math.min(
        ...alignment.map((point) => point.correlation),
      ),
    }) + '\n',
  );
}
