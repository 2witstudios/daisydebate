import { resolve } from 'node:path';
import { browserDriverOptions, finishBrowserDriver } from './browser-driver';

/**
 * Runs the bot Freestyle drill through the Launch harness in the heavy queue:
 * nightly in e2e.yml (cohort bot-freestyle) once the repository secret
 * E2E_OPENROUTER_API_KEY is set, and on demand. It needs espeak-ng.
 */
const checkout = resolve(import.meta.dir, '../../../..');
const queued = Bun.spawn(
  [
    'bun',
    '../../scripts/heavy.ts',
    'bun',
    'e2e/support/bot-freestyle-queued.ts',
  ],
  // The web server speaks to real OpenRouter only under E2E_OPENROUTER_API_KEY;
  // without it the placeholder key answers every bot call from the local stub.
  browserDriverOptions(checkout, {
    ...process.env,
    E2E_OPENROUTER_API_KEY:
      process.env.E2E_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY,
  }),
);
await finishBrowserDriver(queued);
