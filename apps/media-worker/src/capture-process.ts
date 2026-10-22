import { disposeCaptureRuntime } from '@daisy/media/capture';
import { createOpenRouter } from '@daisy/ai-voice';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { runCaptureSession } from './capture-session';

// Native SDK stdout/stderr are isolated by start.ts. No PCM, text or raw errors leave this process.
const [roundId, sessionId, workerId] = process.argv.slice(2);
if (
  ![roundId, sessionId, workerId].every(
    (id) => idSchema.safeParse(id).success,
  ) ||
  !roundId ||
  !sessionId ||
  !workerId
)
  throw createAppError('VALIDATION');
const url = process.env.PUBLIC_APP_URL,
  secret = process.env.MEDIA_WORKER_SECRET,
  apiKey = process.env.OPENROUTER_API_KEY;
if (!url || !secret || !apiKey)
  throw createAppError(
    'INFRASTRUCTURE',
    'Capture capability is not configured',
  );
const authentication = createMediaWorkerAuthentication({
  secret,
  now: Date.now,
});
const client = createMediaWorkerClient({
  scope: { roundId, sessionId, workerId },
  url,
  authentication,
  fetch,
  nowMs: performance.now,
  deadlineSignal: () => AbortSignal.timeout(3000),
});
const stop = new AbortController();
process.on('SIGTERM', () => stop.abort());
process.on('SIGINT', () => stop.abort());
try {
  await runCaptureSession(
    {
      roundId,
      client,
      voice: createOpenRouter({ apiKey, fetch }),
      sttModel: 'openai/whisper-large-v3-turbo',
      nowMs: performance.now,
      waitUntilMs: async (due, signal) => {
        while (performance.now() < due && !signal.aborted)
          await Bun.sleep(Math.max(1, Math.min(25, due - performance.now())));
      },
    },
    stop.signal,
  );
} catch {
  process.exitCode = 1;
} finally {
  await disposeCaptureRuntime();
}
