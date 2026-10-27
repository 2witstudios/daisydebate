import {
  CAPTURE_CALL_DEADLINE_MS,
  CAPTURE_STT_TIMEOUT_MS,
} from '@daisy/protocol';
import {
  createCaptureSubscription,
  disposeCaptureRuntime,
} from '@daisy/media/capture';
import { consumeCaptureClips } from './capture-consumer';
import { createOpenRouter } from '@daisy/ai-voice';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { createBotListenerClient } from '@daisy/media/bot-listener';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { runCaptureSession } from './capture-session';
import { keepListening, runBotListener } from './bot-listener';
import { createPeerAudioTap } from './peer-audio';
import { CAPTURE_FINISHED_EXIT } from './supervisor';
import {
  CAPTURE_UNCAUGHT_EXIT,
  captureFailureExit,
  startRefusalExit,
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
  const transport = {
    scope: { roundId, sessionId, workerId },
    url,
    authentication,
    fetch: input.fetch,
    nowMs: performance.now,
    deadlineSignal: () => AbortSignal.timeout(CAPTURE_CALL_DEADLINE_MS),
  };
  const client = createMediaWorkerClient(transport);
  const waitUntilMs = async (due: number, signal: AbortSignal) => {
    while (performance.now() < due && !signal.aborted)
      await Bun.sleep(Math.max(1, Math.min(25, due - performance.now())));
  };
  const stop = new AbortController();
  process.on('SIGTERM', () => stop.abort());
  process.on('SIGINT', () => stop.abort());
  // The one LiveKit subscription feeds a named read-only input that the bot
  // listener, its own role with its own lease (ISSUE-764), reads; capture
  // never relays for bots. The listener ends with capture and never fails it.
  const audio = createPeerAudioTap();
  const listenerStop = new AbortController();
  const listenerClient = createBotListenerClient(transport);
  const listening = keepListening(
    {
      run: (signal) =>
        runBotListener(
          {
            client: listenerClient,
            audio,
            nowMs: performance.now,
            waitUntilMs,
          },
          signal,
        ),
      nowMs: performance.now,
      waitUntilMs,
    },
    AbortSignal.any([stop.signal, listenerStop.signal]),
  );
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
        subscribe: (options) =>
          createCaptureSubscription({
            ...options,
            onFrame: (frame) => {
              audio.publish(frame);
              options.onFrame(frame);
            },
          }),
        consume: consumeCaptureClips,
        nowMs: performance.now,
        waitUntilMs,
      },
      stop.signal,
    );
    process.exitCode = exitStatus(ended.closed);
  } catch (error) {
    process.exitCode = startRefusalExit(error);
  } finally {
    listenerStop.abort();
    await listening;
    await disposeCaptureRuntime();
  }
}

/** A capture closed for good finishes the session; it is never relaunched. */
const exitStatus = (closed: boolean) => (closed ? CAPTURE_FINISHED_EXIT : 0);
