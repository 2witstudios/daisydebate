import { SQL } from 'bun';
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { slotDatabaseOfRun } from '@daisy/db/test-runs';
import { createRecordingWorkerStore } from '@daisy/db/recording-worker';
import { buildRecording, type BuildPorts } from '../src/build-recording';
import { localFiles, runCommand } from '../src/local-ports';
import { runWorker } from '../src/worker';

const request = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('source'),
    root: z.string(),
    prefix: z.string().regex(/^recording-hold\/[a-z0-9]{24}\/1\/$/),
    at: z.number(),
    durationMs: z.number().positive().max(15_000),
  }),
  z.object({
    action: z.literal('build'),
    root: z.string(),
    recordingId: z.string().regex(/^[a-z0-9]{24}$/),
    owner: z.string().regex(/^[a-z0-9]{24}$/),
  }),
]);
async function source(
  input: Extract<z.infer<typeof request>, { action: 'source' }>,
) {
  const dir = join(input.root, 'hold', input.prefix);
  await mkdir(dir, { recursive: true });
  await runCommand(new AbortController().signal)([
    'ffmpeg',
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=green:s=1280x720:r=30:d=${input.durationMs / 1000}`,
    '-f',
    'lavfi',
    '-i',
    `sine=f=440:d=${input.durationMs / 1000}`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-threads',
    '1',
    '-c:a',
    'aac',
    join(dir, 'full.mp4'),
  ]);
  await runCommand(new AbortController().signal)([
    'ffmpeg',
    '-y',
    '-loglevel',
    'error',
    '-i',
    join(dir, 'full.mp4'),
    '-c',
    'copy',
    '-f',
    'mpegts',
    join(dir, 'part.ts'),
  ]);
  await Bun.write(
    join(dir, 'p.m3u8'),
    `#EXTM3U\n#EXT-X-PROGRAM-DATE-TIME:${new Date(input.at).toISOString()}\n#EXTINF:${input.durationMs / 1000},\npart.ts\n#EXT-X-ENDLIST\n`,
  );
  return {
    action: 'source',
    sourceBytes: Bun.file(join(dir, 'full.mp4')).size,
    durationMs: input.durationMs,
  };
}
function localPorts(
  root: string,
  workDir: string,
  signal: AbortSignal,
  progress: BuildPorts['progress'],
): BuildPorts {
  return {
    hold: {
      readText: async (key) => {
        const file = Bun.file(join(root, 'hold', key));
        return (await file.exists()) ? file.text() : '';
      },
      listNames: (prefix) => readdir(join(root, 'hold', prefix)),
      download: async (key, path) => {
        await Bun.write(path, Bun.file(join(root, 'hold', key)));
      },
    },
    recordings: {
      upload: async (key, path) => {
        const target = join(root, 'objects', key);
        await mkdir(dirname(target), { recursive: true });
        await Bun.write(target, Bun.file(path));
      },
      sizes: async (prefix) =>
        new Map(
          [...(await localFiles.list(join(root, 'objects', prefix)))].map(
            ([key, size]) => [`${prefix}${key}`, size],
          ),
        ),
    },
    files: localFiles,
    run: runCommand(signal),
    progress,
    slatePath: new URL('../assets/gap-slate.png', import.meta.url).pathname,
    workDir,
    now: () => new Date().toISOString(),
  };
}
/** The local hold really becomes empty; original source bytes remain archived for evidence. */
async function archiveDiscard(root: string, prefix: string) {
  if (!/^recording-hold\/[a-z0-9]{24}\/$/.test(prefix))
    throw Error('Foreign hold namespace');
  const from = join(root, 'hold', prefix),
    target = join(root, 'retained-hold', prefix);
  const files = await localFiles
    .list(from)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  if (!files) return 0;
  await mkdir(dirname(target.slice(0, -1)), { recursive: true });
  await rename(from, target);
  return files.size;
}
async function processJob(
  input: Extract<z.infer<typeof request>, { action: 'build' }>,
  url: URL,
) {
  url.searchParams.set('options', '-c role=daisy_recording_worker');
  const check = new SQL(url.toString(), { max: 1 });
  const [role] = await check`select current_user as role`;
  await check.close();
  if (role?.role !== 'daisy_recording_worker')
    throw Error('Worker role was not established');
  const store = createRecordingWorkerStore(url.toString()),
    failures: string[] = [];
  let built = false,
    output: unknown = null;
  const stages: string[] = [];
  let buildError: unknown = null;
  try {
    await runWorker({
      owner: input.owner,
      store: {
        ...store,
        claim: async (input) => {
          const job = await store.claim(input);
          if (job) stages.push('claim_' + job.status);
          return job;
        },
      },
      build: async (job, run) => {
        if (job.recordingId !== input.recordingId)
          throw Error('Foreign recording job');
        const value = await buildRecording(
          localPorts(input.root, run.workDir, run.signal, run.progress),
          job,
        ).catch((error) => {
          buildError =
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { name: 'unknown' };
          throw error;
        });
        output =
          value.status === 'built'
            ? {
                status: value.status,
                durationMs: value.media.durationMs,
                byteSize: value.media.byteSize,
              }
            : { status: value.status };
        built = true;
        return value;
      },
      discardPage: (prefix) => archiveDiscard(input.root, prefix),
      strip: async () => {
        throw Error('No strip in build qualification');
      },
      workDirOf: () => join(input.root, 'work', input.recordingId),
      removeWorkDir: async () => {},
      now: Date.now,
      sleep: (ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms).unref();
        }),
      stopped: () => built,
      report: (event) => {
        failures.push(event);
        built = true;
      },
    });
    if (failures.length) throw Error('Actual worker reported a failure');
    return { action: 'build', role: role.role, output, stages };
  } finally {
    await writeFile(
      join(input.root, 'worker-' + input.recordingId + '.json'),
      JSON.stringify(
        { role: role.role, stages, output, failures, buildError },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await store.close();
  }
}
if (import.meta.main) {
  const run = process.env.TEST_RUN_DATABASE,
    url = new URL(process.env.TEST_DATABASE_URL ?? 'about:blank');
  if (!run || !slotDatabaseOfRun(run) || url.pathname !== `/${run}`)
    throw Error('Owned canonical run required');
  const input = request.parse(JSON.parse(await Bun.stdin.text()));
  if (
    !input.root.startsWith('/tmp/billing-capture-') ||
    input.root.includes('..')
  )
    throw Error('Private owned output required');
  process.stdout.write(
    JSON.stringify(
      input.action === 'source'
        ? await source(input)
        : await processJob(input, url),
    ),
  );
}
