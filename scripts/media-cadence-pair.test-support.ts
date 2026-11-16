import { createHash } from 'node:crypto';
import { freemem, loadavg, totalmem } from 'node:os';
import { createStreamingAudioWriter } from '../packages/media/src/audio-stream';

export const classifyCadencePair = (input: {
  readonly writerMaxGapMs: number;
  readonly controlMaxGapMs: number;
  readonly writerOnTime: boolean;
  readonly controlOnTime: boolean;
}) => {
  if (
    !Number.isFinite(input.writerMaxGapMs) ||
    !Number.isFinite(input.controlMaxGapMs)
  )
    return 'inconclusive';
  if (!input.controlOnTime || input.controlMaxGapMs >= 60)
    return 'environmental-or-inconclusive';
  if (!input.writerOnTime || input.writerMaxGapMs >= 60)
    return 'writer-delay-not-explained-by-control';
  return 'no-failure-observed';
};

/** One finite acquisition. Importing this module never starts a timer experiment. */
const observe = async () => {
  const sourceHead = process.argv[2];
  if (!sourceHead || !/^[a-f0-9]{40}$/.test(sourceHead))
    throw new Error('Reviewed source identity required');
  const pcm = new Int16Array(30 * 240);
  const writerStamps: number[] = [];
  const controlStamps: number[] = [];
  const waits: {
    caller: 'writer' | 'control';
    due: number;
    entered: number;
    resumed: number;
  }[] = [];
  const origin = performance.now();
  const pressureBefore = {
    freeMemory: freemem(),
    totalMemory: totalmem(),
    loadAverage: loadavg(),
    usage: process.resourceUsage(),
  };
  const wait = async (caller: 'writer' | 'control', due: number) => {
    const entered = performance.now();
    // Identical primitive and deadline loop to the original failing writer fixture.
    while (performance.now() < due)
      await Bun.sleep(Math.max(1, due - performance.now()));
    waits.push({
      caller,
      due: due - origin,
      entered: entered - origin,
      resumed: performance.now() - origin,
    });
  };
  let concurrentResolved = false;
  const concurrent = Bun.sleep(200).then(() => {
    concurrentResolved = true;
  });
  const control = (async () => {
    for (let frame = 0; frame < 30; frame += 1) {
      await wait('control', origin + frame * 10);
      controlStamps.push(performance.now() - origin);
    }
  })();
  const writer = createStreamingAudioWriter({
    target: {
      capture10ms: async () => {
        writerStamps.push(performance.now() - origin);
      },
      queuedMs: () => 0,
      clearQueue: () => undefined,
    },
    sampleRate: 24000,
    channels: 1,
    nowMs: () => performance.now(),
    waitUntilMs: (due) => wait('writer', due),
    leadMs: 0,
  });
  const writerStarted = performance.now() - origin;
  const result = await writer(pcm, new AbortController().signal);
  await Promise.all([control, concurrent]);
  const maxGap = (stamps: readonly number[]) =>
    Math.max(...stamps.slice(1).map((at, index) => at - stamps[index]!));
  const gaps = {
    writerMaxGapMs: maxGap(writerStamps),
    controlMaxGapMs: maxGap(controlStamps),
  };
  process.stdout.write(
    JSON.stringify({
      event: 'media.cadencePairedControl',
      sourceHead,
      sourceBlob: createHash('sha256')
        .update(
          await Bun.file('packages/media/src/audio-stream.ts').arrayBuffer(),
        )
        .digest('hex'),
      bunVersion: Bun.version,
      platform: process.platform,
      architecture: process.arch,
      input: {
        frames: 30,
        samplesPerFrame: 240,
        sampleRate: 24000,
        channels: 1,
        leadMs: 0,
        queuedMs: 0,
        pcmSha256: createHash('sha256')
          .update(new Uint8Array(pcm.buffer))
          .digest('hex'),
      },
      thresholdMs: 60,
      writerStarted,
      writerStamps,
      controlStamps,
      waits,
      gaps,
      writerBefore190: writerStamps.filter((at) => at - writerStarted < 190)
        .length,
      result,
      concurrentResolved,
      classification: classifyCadencePair({
        ...gaps,
        writerOnTime:
          writerStamps.filter((at) => at - writerStarted < 190).length >= 15,
        controlOnTime: controlStamps.filter((at) => at < 190).length >= 15,
      }),
      pressureBefore,
      pressureAfter: {
        freeMemory: freemem(),
        totalMemory: totalmem(),
        loadAverage: loadavg(),
        usage: process.resourceUsage(),
      },
      elapsedMs: performance.now() - origin,
      limitation:
        'one paired JS-timer fixture; no native audio, no attribution to GC/CPU/host, no product PASS or waiver, publication setTimeout is not measured',
    }) + '\n',
  );
};

if (import.meta.main) await observe();
