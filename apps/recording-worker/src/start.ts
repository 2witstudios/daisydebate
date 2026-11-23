import { createRecordingWorkerStore } from '@daisy/db/recording-worker';
import { createLogger } from '@daisy/logger';
import { stopAll } from '@daisy/worker';
import { hostWaits } from '@daisy/worker/host';
import { createId } from '@paralleldrive/cuid2';
import { buildRecording } from './build-recording';
import { readWorkerConfig } from './config';
import { localFiles, removeWorkDir, runCommand } from './local-ports';
import { createObjects } from './objects';
import { stripSources } from './strip-sources';
import { startRecordingSlot } from './worker';

/** Within Fly's grace: a build stuck past it is abandoned and its lease lapses. */
const DRAIN_MS = 20_000;

// The deployment edge: the real environment, clock, time and process signals.
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
const workers = Array.from({ length: config.RECORDING_WORKER_SLOTS }, () =>
  startRecordingSlot({
    owner: createId(),
    store,
    build: (job, { workDir, signal, progress }) =>
      buildRecording(
        {
          hold: objects.hold,
          recordings: objects.recordings,
          files: localFiles,
          run: runCommand(signal),
          progress,
          slatePath,
          workDir,
          now: () => new Date(realClock()).toISOString(),
        },
        job,
      ),
    discardPage: objects.discardPage,
    strip: (holdPrefix, intervals) =>
      stripSources(objects.hold, holdPrefix, intervals, realClock()),
    workDirOf: (recordingId, owner) =>
      `${config.RECORDING_WORK_DIR}/${recordingId}-${owner}`,
    removeWorkDir,
    now: realClock,
    waits: hostWaits,
    report: (event) => logger.log(event, {}, 'Recording worker failure'),
  }),
);
const shutdown = async () => {
  const drain = await stopAll({
    waits: hostWaits,
    workers,
    deadlineMs: DRAIN_MS,
  });
  if (drain === 'overdue') process.exit(1);
  await store.close();
  process.exit(0);
};
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => void shutdown());
