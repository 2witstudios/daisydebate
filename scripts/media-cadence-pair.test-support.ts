import { createHash } from 'node:crypto';
import { freemem, loadavg, totalmem } from 'node:os';
import { z } from 'zod';
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

/** ArrayBuffer is not accepted directly by node:crypto Hash.update. */
export const cadenceSourceDigest = (source: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(source)).digest('hex');

const finite = z.number().finite().nonnegative();
const pressure = z
  .object({
    freeMemory: finite,
    totalMemory: finite,
    loadAverage: z.array(finite).length(3),
    usage: z.record(z.string(), finite),
  })
  .strict();
const limitation =
  'one paired JS-timer fixture; no native audio, no attribution to GC/CPU/host, no product PASS or waiver, publication setTimeout is not measured';
const pcmSha256 = createHash('sha256')
  .update(new Uint8Array(14400))
  .digest('hex');
const observationSchema = z
  .object({
    event: z.literal('media.cadencePairedControl'),
    sourceHead: z.string().regex(/^[a-f0-9]{40}$/),
    sourceBlob: z.string().regex(/^[a-f0-9]{64}$/),
    bunVersion: z.string().min(1).max(32),
    platform: z.string().min(1).max(16),
    architecture: z.string().min(1).max(16),
    input: z
      .object({
        frames: z.literal(30),
        samplesPerFrame: z.literal(240),
        sampleRate: z.literal(24000),
        channels: z.literal(1),
        leadMs: z.literal(0),
        queuedMs: z.literal(0),
        pcmSha256: z.literal(pcmSha256),
      })
      .strict(),
    thresholdMs: z.literal(60),
    writerStarted: finite,
    writerStamps: z.array(finite).length(30),
    controlStamps: z.array(finite).length(30),
    waits: z
      .array(
        z
          .object({
            caller: z.enum(['writer', 'control']),
            due: finite,
            entered: finite,
            resumed: finite,
          })
          .strict(),
      )
      .min(30)
      .max(60),
    gaps: z
      .object({ writerMaxGapMs: finite, controlMaxGapMs: finite })
      .strict(),
    writerBefore190: z.number().int().min(0).max(30),
    controlBefore190: z.number().int().min(0).max(30),
    result: z
      .object({
        sentSamples: z.literal(7200),
        playedSamples: z.literal(7200),
        aborted: z.literal(false),
        cut: z.literal(false),
      })
      .strict(),
    concurrentResolved: z.literal(true),
    classification: z.enum([
      'inconclusive',
      'environmental-or-inconclusive',
      'writer-delay-not-explained-by-control',
      'no-failure-observed',
    ]),
    pressureBefore: pressure,
    pressureAfter: pressure,
    elapsedMs: finite.max(5000),
    limitation: z.literal(limitation),
  })
  .strict();

export const decodeCadenceObservation = (
  text: string,
  expectedHead?: string,
) => {
  const data = observationSchema.parse(JSON.parse(text));
  const gap = (stamps: readonly number[]) =>
    Math.max(...stamps.slice(1).map((at, index) => at - stamps[index]!));
  const writerBefore190 = data.writerStamps.filter(
    (at) => at - data.writerStarted < 190,
  ).length;
  const controlBefore190 = data.controlStamps.filter((at) => at < 190).length;
  const monotonic = (stamps: readonly number[]) =>
    stamps.every(
      (at, index) =>
        at <= data.elapsedMs && (index === 0 || at >= stamps[index - 1]!),
    );
  if (
    (expectedHead && data.sourceHead !== expectedHead) ||
    !monotonic(data.writerStamps) ||
    !monotonic(data.controlStamps) ||
    data.waits.some(
      (wait) => wait.resumed < wait.entered || wait.resumed > data.elapsedMs,
    ) ||
    data.gaps.writerMaxGapMs !== gap(data.writerStamps) ||
    data.gaps.controlMaxGapMs !== gap(data.controlStamps) ||
    data.writerBefore190 !== writerBefore190 ||
    data.controlBefore190 !== controlBefore190 ||
    data.classification !==
      classifyCadencePair({
        ...data.gaps,
        writerOnTime: writerBefore190 >= 15,
        controlOnTime: controlBefore190 >= 15,
      })
  )
    throw new Error('Observer evidence inconsistent');
  return data;
};

export const sanitizeCadenceError = (text: string) =>
  text
    .replaceAll(process.cwd(), '<checkout>')
    .split('\n')
    .map((original) => {
      const line = original.replace(/https?:\/\/[^\s"']+/g, '<url>');
      if (
        /authorization|cookie|password|secret|token|api[-_ ]?key|bearer/i.test(
          line,
        )
      )
        return '<credential-bearing line suppressed>';
      return line
        .replace(
          /\/(?:Users|home|tmp|private|var|Volumes)\/[^\s"'`]+/g,
          '<path>',
        )
        .slice(0, 320);
    })
    .join('\n');

/** Capture a completed child and preserve bounded output even when observation parsing fails. */
export const captureCadenceObserver = async (
  command: readonly string[],
  expectedHead?: string,
) => {
  const started = performance.now();
  const child = Bun.spawn([...command], {
    timeout: 5000,
    killSignal: 'SIGKILL',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const read = async (stream: ReadableStream<Uint8Array>, limit: number) => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    const hash = createHash('sha256');
    let bytes = 0;
    let retained = 0;
    let truncated = false;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      hash.update(next.value);
      const part = next.value.subarray(0, Math.max(0, limit - retained));
      chunks.push(part);
      retained += part.byteLength;
      if (bytes > limit) {
        truncated = true;
        child.kill('SIGKILL');
        await reader.cancel();
        break;
      }
    }
    return {
      bytes,
      sha256: hash.digest('hex'),
      text: Buffer.concat(chunks).toString('utf8'),
      truncated,
    };
  };
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    read(child.stdout, 65536),
    read(child.stderr, 16384),
  ]);
  let observation: unknown = null;
  let parseError: string | null =
    stdout.truncated || stderr.truncated ? 'observer-output-truncated' : null;
  if (exitCode === 0 && !stdout.truncated && !stderr.truncated) {
    try {
      JSON.parse(stdout.text);
      try {
        observation = decodeCadenceObservation(stdout.text, expectedHead);
      } catch {
        parseError = 'observer-schema-refused';
      }
    } catch {
      parseError = 'observer-output-not-json';
    }
  }
  return {
    exitCode,
    signal: child.signalCode,
    joined: true,
    elapsedMs: performance.now() - started,
    stdout: { ...stdout, text: sanitizeCadenceError(stdout.text) },
    stderr: { ...stderr, text: sanitizeCadenceError(stderr.text) },
    observation,
    parseError,
  };
};

/** One finite acquisition. Importing this module never starts a timer experiment. */
const observe = async (sourceHead: string | undefined) => {
  if (!sourceHead || !/^[a-f0-9]{40}$/.test(sourceHead))
    throw new Error('Reviewed source identity required');
  const sourceBlob = cadenceSourceDigest(
    await Bun.file('packages/media/src/audio-stream.ts').arrayBuffer(),
  );
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
      sourceBlob,
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
      limitation,
    }) + '\n',
  );
};

if (import.meta.main) {
  if (process.argv[2] === '--observe') await observe(process.argv[3]);
  else
    process.stdout.write(
      JSON.stringify(
        await captureCadenceObserver(
          [
            process.execPath,
            import.meta.path,
            '--observe',
            process.argv[2] ?? '',
          ],
          process.argv[2],
        ),
      ) + '\n',
    );
}
