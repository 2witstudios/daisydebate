import { createRecordingWorkerStore } from '@daisy/db/recording-worker';
import { createLogger } from '@daisy/logger';
import { createId } from '@paralleldrive/cuid2';
import { buildRecording } from './build-recording';
import { readWorkerConfig } from './config';
import { localFiles, removeWorkDir, runCommand } from './local-ports';
import { createObjects } from './objects';
import { runWorker } from './worker';

// The deployment edge: the real environment, clock and process signals.
const config = readWorkerConfig(process.env);
const store = createRecordingWorkerStore(config.RECORDING_WORKER_DATABASE_URL);
const objects = createObjects({
  hold: {
    endpoint: config.RECORDING_HOLD_ENDPOINT,
    bucket: config.RECORDING_HOLD_BUCKET,
    key: config.RECORDING_HOLD_KEY,
    secret: config.RECORDING_HOLD_SECRET,
    region: 'auto',
  },
  recordings: {
    endpoint: config.RECORDING_BUCKET_ENDPOINT,
    bucket: config.RECORDING_BUCKET_NAME,
    key: config.RECORDING_BUCKET_ACCESS_KEY_ID,
    secret: config.RECORDING_BUCKET_SECRET_ACCESS_KEY,
    region: config.RECORDING_BUCKET_REGION,
  },
});
const logger = createLogger({ service: 'recording-worker' });
const realClock = Date.now;
const slatePath = new URL('../assets/gap-slate.png', import.meta.url).pathname;
let stopping = false;
const stopped = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    stopping = true;
    stopped.abort();
  });
await Promise.all(
  Array.from({ length: config.RECORDING_WORKER_SLOTS }, () =>
    runWorker({
      owner: createId(),
      store,
      build: (job, { workDir, signal, progress }) =>
        buildRecording(
          {
            hold: objects.hold,
            recordings: objects.recordings,
            files: localFiles,
            run: runCommand(AbortSignal.any([signal, stopped.signal])),
            progress,
            povMissing: () =>
              logger.log(
                'recording.pov_missing',
                {},
                'Recording worker failure',
              ),
            slatePath,
            workDir,
            now: () => new Date(realClock()).toISOString(),
          },
          job,
        ),
      discardPage: objects.discardPage,
      workDirOf: (recordingId, owner) =>
        `${config.RECORDING_WORK_DIR}/${recordingId}-${owner}`,
      removeWorkDir,
      now: realClock,
      sleep: Bun.sleep,
      stopped: () => stopping,
      report: (event) => logger.log(event, {}, 'Recording worker failure'),
    }),
  ),
);
await store.close();
