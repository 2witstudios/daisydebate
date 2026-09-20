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
  // dotenv-style loaders honor the last assignment, so only the final
  // BETTER_AUTH_SECRET line counts as the effective value. A whitespace-only
  // value counts as absent so blank and CRLF assignments regenerate.
  const assignments = [...content.matchAll(/^BETTER_AUTH_SECRET=.*$/gm)];
  const effective = assignments.at(-1);
  if (
    effective &&
    effective[0].slice('BETTER_AUTH_SECRET='.length).trim() !== ''
  )
    return { content, changed: false };
  const secret = generate();
  if (!secretCharset.test(secret))
    throw new Error(
      'Generated auth secret must be 64 non-whitespace characters',
    );
  const written = effective
    ? `${content.slice(0, effective.index)}BETTER_AUTH_SECRET=${secret}${
        effective[0].endsWith('\r') ? '\r' : ''
      }${content.slice(effective.index + effective[0].length)}`
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
