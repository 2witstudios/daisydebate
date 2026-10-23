import {
  CAPTURE_CALL_DEADLINE_MS,
  CAPTURE_STT_TIMEOUT_MS,
} from '@daisy/protocol';
import { disposeCaptureRuntime } from '@daisy/media/capture';
import { createOpenRouter } from '@daisy/ai-voice';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { idSchema } from '@daisy/protocol';
import { runCaptureSession } from './capture-session';

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * One capture session's process. Native SDK stdout/stderr are isolated by the
 * worker that spawns it. No PCM, text or raw errors leave this process:
 * refusals exit quietly with status 1. `fetch` carries the signed web ingress
 * and the speech-to-text call; capture-process.ts passes the real one.
 */
export async function runCaptureProcess(input: {
  readonly argv: readonly string[];
  readonly env: Record<string, string | undefined>;
  readonly fetch: Fetch;
}) {
  const [roundId, sessionId, workerId] = input.argv;
  if (
    ![roundId, sessionId, workerId].every(
      (id) => idSchema.safeParse(id).success,
    ) ||
    !roundId ||
    !sessionId ||
    !workerId
  )
    process.exit(1);
  const url = input.env.PUBLIC_APP_URL,
    secret = input.env.MEDIA_WORKER_SECRET,
    apiKey = input.env.OPENROUTER_API_KEY;
  if (!url || !secret || !apiKey) process.exit(1);
  const authentication = createMediaWorkerAuthentication({
    secret,
    now: Date.now,
  });
  const client = createMediaWorkerClient({
    scope: { roundId, sessionId, workerId },
    url,
    authentication,
    fetch: input.fetch,
    nowMs: performance.now,
    deadlineSignal: () => AbortSignal.timeout(CAPTURE_CALL_DEADLINE_MS),
  });
  const stop = new AbortController();
  process.on('SIGTERM', () => stop.abort());
  process.on('SIGINT', () => stop.abort());
  try {
    await runCaptureSession(
      {
        roundId,
        client,
        voice: createOpenRouter({
          apiKey,
          fetch: input.fetch,
          timeoutMs: CAPTURE_STT_TIMEOUT_MS,
        }),
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
}
