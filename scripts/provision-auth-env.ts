/**
 * Provision BETTER_AUTH_SECRET in the local .env when it is absent or empty.
 * The value is written directly into .env and never printed or logged.
 * Usage: bun scripts/provision-auth-env.ts
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const secretCharset = /^\S{64}$/;

export function generateAuthSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

export function provisionAuthSecret(
  content: string,
  { generate }: { generate: () => string },
): { content: string; changed: boolean } {
  const existing = content.match(/^BETTER_AUTH_SECRET=(.*)$/m);
  // An existing non-empty value is preserved verbatim; an empty assignment
  // counts as absent so copying .env.example yields a provisioned .env.
  if (existing && existing[1] !== '') return { content, changed: false };
  const secret = generate();
  if (!secretCharset.test(secret))
    throw new Error(
      'Generated auth secret must be 64 non-whitespace characters',
    );
  const written = existing
    ? content.replace(
        /^BETTER_AUTH_SECRET=.*$/m,
        `BETTER_AUTH_SECRET=${secret}`,
      )
    : `${content}${content && !content.endsWith('\n') ? '\n' : ''}BETTER_AUTH_SECRET=${secret}\n`;
  return { content: written, changed: true };
}

const envPath = resolve(import.meta.dir, '..', '.env');

async function main() {
  let content = '';
  try {
    content = await readFile(envPath, 'utf8');
  } catch {
    console.error('Missing .env file; copy .env.example to .env first.');
    process.exitCode = 1;
    return;
  }
  const result = provisionAuthSecret(content, { generate: generateAuthSecret });
  if (!result.changed) {
    console.log('BETTER_AUTH_SECRET: existing value preserved.');
    return;
  }
  await Bun.write(envPath, result.content);
  console.log(
    'BETTER_AUTH_SECRET: generated a new 64-character value into .env.',
  );
}

if (import.meta.main) await main();
