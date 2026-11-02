import { withOpenRouterStub } from '@daisy/ai-voice/testing';
import type { createAudioSubscription } from '@daisy/media/subscription';
import { runCaptureProcess } from '../src/capture-run';

/**
 * A real capture process with every real part but LiveKit, which steady frames
 * of 400 ms speech and 600 ms pauses replace, so clips cut as speech cuts them, for proofs that take the web app away and signal this process.
 * Speech-to-text is the OpenRouter stub; nothing here reaches a provider.
 */
const voiced = new Int16Array(160).fill(8000);
const silent = new Int16Array(160);
const subscribe = (async (setup: {
  readonly onFrame: (frame: never) => void;
}) => {
  const identity = process.env.PROOF_IDENTITY!;
  let sequence = 0;
  const started = performance.now();
  const beat = () => {
    // Every frame due by now, as a real track delivers through a stall.
    while (started + sequence * 10 <= performance.now()) {
      const afterMs = performance.now();
      setup.onFrame({
        identity,
        trackId: 'track',
        sequence: sequence++,
        beforeMs: afterMs - 1,
        afterMs,
        pcm: sequence % 100 < 40 ? voiced : silent,
      } as never);
    }
  };
  const frames = setInterval(beat, 10);
  return {
    closed: new Promise(() => undefined),
    setIdentities: async () => undefined,
    close: async () => clearInterval(frames),
  };
}) as unknown as typeof createAudioSubscription;

await runCaptureProcess({
  argv: process.argv.slice(2),
  env: process.env,
  fetch: withOpenRouterStub(process.env.OPENROUTER_API_KEY, fetch),
  subscribe,
});
process.exit();
