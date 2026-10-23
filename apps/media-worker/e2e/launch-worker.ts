import { startMediaWorker } from '../src/worker';

// The launch composition's capture worker: the production worker, spawning
// the launch capture entry for each session.
await startMediaWorker({
  env: process.env,
  captureEntry: Bun.resolveSync('./launch-capture.ts', import.meta.dir),
});
