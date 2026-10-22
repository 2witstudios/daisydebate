import { systemId } from '@daisy/clock';
import { readMediaWorkerConfig, type MediaWorkerConfig } from '@daisy/config';
import { createMediaWorkerDatabase } from '@daisy/db/media-worker';
import { isAppError } from '@daisy/errors';
import { createLogger } from '@daisy/logger';
import { createCaptureSupervisor } from './supervisor';

// The deployment edge. Each session runs in its own capture process so native
// SDK stdout/stderr, PCM and text never reach this process or shared logs.
const logger = createLogger({ service: 'media-worker' });
const refuse = (cause: string) => {
  logger.log('server.shutdown', { cause }, 'Capture worker refused to start');
  process.exit(1);
};
let config: MediaWorkerConfig;
try {
  config = readMediaWorkerConfig(process.env);
} catch {
  refuse('configuration');
}
const database = createMediaWorkerDatabase({
  url: config!.MEDIA_WORKER_DATABASE_URL,
});
try {
  if ((await database.privilegeProblems()).length > 0) refuse('privilege');
} catch {
  refuse('database');
}
const processEntry = Bun.resolveSync('./capture-process.ts', import.meta.dir);
const supervisor = createCaptureSupervisor({
  maxSessions: config!.MEDIA_WORKER_MAX_SESSIONS,
  retryMs: { initial: 1000, max: 30000 },
  nowMs: performance.now,
  nextWorkerId: () => systemId.next(),
  discover: database.discoverCaptureSessions,
  failed: (status) =>
    logger.log('media.capture.failed', { status }, 'Capture process failed'),
  launch: (scope) => {
    const child = Bun.spawn(
      [
        process.execPath,
        processEntry,
        scope.roundId,
        scope.sessionId,
        scope.workerId,
      ],
      {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
        env: {
          PUBLIC_APP_URL: config!.PUBLIC_APP_URL,
          MEDIA_WORKER_SECRET: config!.MEDIA_WORKER_SECRET,
          OPENROUTER_API_KEY: config!.OPENROUTER_API_KEY,
        },
      },
    );
    return {
      exited: child.exited,
      stop: () => {
        child.kill('SIGTERM');
        const deadline = setTimeout(() => child.kill('SIGKILL'), 20000);
        void child.exited.finally(() => clearTimeout(deadline));
      },
    };
  },
});
let scanning: Promise<void> | undefined;
const scan = () => {
  scanning ??= supervisor
    .tick()
    .catch((error: unknown) =>
      logger.log(
        'media.discovery.failed',
        { errorCode: isAppError(error) ? error.code : 'INFRASTRUCTURE' },
        'Capture session discovery failed',
      ),
    )
    .finally(() => {
      scanning = undefined;
    });
};
const timer = setInterval(scan, 1000);
scan();
logger.log('server.ready', {}, 'Capture worker ready');
let stopping: Promise<void> | undefined;
const stop = () => {
  stopping ??= (async () => {
    clearInterval(timer);
    await scanning;
    await supervisor.stop();
    await database.close();
    logger.log('server.shutdown', {}, 'Capture worker stopped');
  })();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
