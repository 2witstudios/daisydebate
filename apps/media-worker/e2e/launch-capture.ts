import { withOpenRouterStub } from '@daisy/ai-voice/testing';
import { runCaptureProcess } from '../src/capture-run';

// The launch composition's capture entry: the production session runner, with
// speech-to-text answered by the OpenRouter stub when the key is the
// placeholder (VIDEO-3.10). A real key reaches OpenRouter.
await runCaptureProcess({
  argv: process.argv.slice(2),
  env: process.env,
  fetch: withOpenRouterStub(process.env.OPENROUTER_API_KEY, fetch),
});
