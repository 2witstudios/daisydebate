import { startMediaWorker } from './worker';

// The deployment edge: the real environment and the production capture entry.
await startMediaWorker({
  env: process.env,
  captureEntry: Bun.resolveSync('./capture-process.ts', import.meta.dir),
});
