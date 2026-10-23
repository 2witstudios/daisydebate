import { runCaptureProcess } from './capture-run';

// The production capture entry: the real arguments, environment and fetch.
await runCaptureProcess({
  argv: process.argv.slice(2),
  env: process.env,
  fetch,
});
