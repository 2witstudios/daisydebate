import {
  CAPTURE_CALL_DEADLINE_MS,
  CAPTURE_STT_TIMEOUT_MS,
} from '@daisy/protocol';
import { disposeCaptureRuntime } from '@daisy/media/capture';
import { createOpenRouter } from '@daisy/ai-voice';
import {
  createMediaWorkerClient,
  isCaptureClosedRefusal,
} from '@daisy/media/worker';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { runCaptureSession } from './capture-session';
import { CAPTURE_FINISHED_EXIT } from './supervisor';
import {
  CAPTURE_UNCAUGHT_EXIT,
  captureFailureExit,
  tagCaptureFailure,
} from './capture-exit';

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * One capture session's process. Native SDK stdout/stderr are isolated by the
 * worker that spawns it. No PCM, text or raw errors leave this process: a
 * failure exits quietly with its enumerated stage and error code
 * (capture-exit.ts). `fetch` carries the signed web ingress and the
 * speech-to-text call; capture-process.ts passes the real one.
 */
export async function runCaptureProcess(input: {
  readonly argv: readonly string[];
  readonly env: Record<string, string | undefined>;
  readonly fetch: Fetch;
}) {
  // A rejection nothing awaited still ends the process, as Bun would, but
  // with a status the worker can tell apart from a staged failure.
  const uncaught = () => process.exit(CAPTURE_UNCAUGHT_EXIT);
  process.on('uncaughtException', uncaught);
  process.on('unhandledRejection', uncaught);
  function refuse(field: string): never {
    process.exit(
      captureFailureExit(
        tagCaptureFailure(
          'configuration',
          createAppError('VALIDATION', `Invalid capture ${field}`),
        ),
      ),
    );
  }
  const [roundId, sessionId, workerId] = input.argv;
  if (
    ![roundId, sessionId, workerId].every(
      (id) => idSchema.safeParse(id).success,
    ) ||
    !roundId ||
    !sessionId ||
    !workerId
  )
    refuse('scope');
  const url = input.env.PUBLIC_APP_URL,
    secret = input.env.MEDIA_WORKER_SECRET,
    apiKey = input.env.OPENROUTER_API_KEY;
  if (!url || !secret || !apiKey) refuse('environment');
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
    const ended = await runCaptureSession(
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
    process.exitCode = exitStatus(ended.closed);
  } catch (error) {
    // Refused at start (lease, token) because the capture is closed for good.
    process.exitCode = isCaptureClosedRefusal(error)
      ? CAPTURE_FINISHED_EXIT
      : captureFailureExit(error);
  } finally {
    await disposeCaptureRuntime();
  }
}

/** A capture closed for good finishes the session; it is never relaunched. */
const exitStatus = (closed: boolean) => (closed ? CAPTURE_FINISHED_EXIT : 0);
