import { resolve } from 'node:path';
import { requireLaunchSlot } from './room-launch-slot';

/** Prints the newest sign-in link the running demo captured for an address. */
const email = (Bun.argv[2] ?? '').toLowerCase();
if (!email.includes('@')) throw new Error('Usage: bun demo:link <email>');
const slot = requireLaunchSlot(
  resolve(import.meta.dir, '../../../..'),
  process.env,
);
const answer = await fetch(
  `http://127.0.0.1:${slot.port + 2}/mails?to=${encodeURIComponent(email)}`,
);
const mails = (await answer.json()) as { text: string }[];
const link = mails.at(-1)?.text.match(/https:\/\/\S+/)?.[0];
if (!link)
  throw new Error(
    `No sign-in mail for ${email} yet: request one on the sign-in page first`,
  );
process.stdout.write(`${link}\n`);
