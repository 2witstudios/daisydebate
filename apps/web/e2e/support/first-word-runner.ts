import { resolve } from 'node:path';
import { browserDriverOptions, finishBrowserDriver } from './browser-driver';

/** Runs the first-word proof through the Launch harness, in the heavy queue. */
const checkout = resolve(import.meta.dir, '../../../..');
const queued = Bun.spawn(
  ['bun', '../../scripts/heavy.ts', 'bun', 'e2e/support/first-word-queued.ts'],
  browserDriverOptions(checkout, { ...process.env }),
);
await finishBrowserDriver(queued);
