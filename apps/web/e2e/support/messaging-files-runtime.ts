import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { messagingBrowserTarget } from './messaging-data';
import { messagingFileProofRuntime } from '../../integration/messaging-file-runtime.test-support';
/** Real scanner/private bytes under the isolated browser slot only; no deploy-time defaults. */
export async function messagingBrowserFiles(
  env: Readonly<Record<string, string | undefined>>,
) {
  if (!env.CLAMD_TEST_PORT) return { runtime: null, close: async () => {} };
  messagingBrowserTarget(env, resolve(import.meta.dirname, '../../../..'));
  const port = Number(env.CLAMD_TEST_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Isolated scanner port required');
  const directory = await mkdtemp(
    join(tmpdir(), 'daisy-browser-private-files-'),
  );
  const runtime = messagingFileProofRuntime(directory, port);
  return {
    runtime,
    close: () => rm(directory, { recursive: true, force: true }),
  };
}
