import { realpath } from 'node:fs/promises';
import { resolveCheckout } from './slot';
import { slotMismatches, type Slot } from './slot-model';

function cleanupURL(value: string | undefined): URL {
  try {
    return new URL(value ?? '');
  } catch {
    throw new Error('Room account cleanup target refused');
  }
}

/** Read-only admission: never opens a database or mutates slot state. */
export function validateRoomCleanupTarget(
  slot: Slot,
  env: Readonly<Record<string, string | undefined>>,
) {
  const refuse = () => {
    throw new Error('Room account cleanup target refused');
  };
  if (slotMismatches(slot, env).length !== 0) refuse();
  const url = cleanupURL(env.E2E_DATABASE_URL);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (database !== slot.e2eDatabase) refuse();
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username !== 'daisy_e2e' ||
    !database.endsWith('_e2e') ||
    url.search ||
    url.hash
  )
    refuse();
  return {
    database,
    role: 'daisy_e2e' as const,
    hostname: url.hostname,
    port: url.port || '5432',
  };
}

async function readRequest() {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of Bun.stdin.stream()) {
    size += chunk.byteLength;
    if (size > 128) throw new Error('input');
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const input: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  );
  if (
    typeof input !== 'object' ||
    input === null ||
    Object.keys(input).length !== 2 ||
    !('version' in input) ||
    input.version !== 1 ||
    !('operation' in input) ||
    input.operation !== 'admit-room-account-cleanup'
  )
    throw new Error('input');
}

if (import.meta.main) {
  let reason = 'input';
  try {
    if (process.argv.length !== 2) throw new Error('input');
    await readRequest();
    reason = 'checkout';
    const checkout = await resolveCheckout(import.meta.dir);
    if ((await realpath(process.cwd())) !== checkout.path)
      throw new Error('checkout');
    reason = 'target';
    const target = validateRoomCleanupTarget(checkout.slot, process.env);
    process.stdout.write(
      JSON.stringify({ version: 1, admitted: true, target }),
    );
  } catch {
    process.stderr.write(
      JSON.stringify({ version: 1, admitted: false, reason }),
    );
    process.exitCode = 1;
  }
}
