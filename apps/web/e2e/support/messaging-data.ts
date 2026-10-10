import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
export function messagingBrowserTarget(
  env: Readonly<Record<string, string | undefined>>,
  folder: string,
) {
  const slot = basename(folder);
  if (!/^wt-[a-z0-9]+$/.test(slot))
    throw new Error('Messaging browser native slot required');
  const url = new URL(env.E2E_DATABASE_URL ?? '');
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.username !== 'daisy_e2e' ||
    url.pathname !== `/daisy_wt_${slot.slice(3)}_e2e`
  )
    throw new Error('Messaging browser own database required');
  return url.toString();
}
export const messagingBrowserSeedAccountsSchema = z
  .array(z.strictObject({ userId: idSchema, username: z.string().min(1) }))
  .min(1);
const accountSchema = z.strictObject({
  userId: idSchema,
  username: z.string().min(1),
  actorId: idSchema,
});
export const messagingBrowserAccountsSchema = z.array(accountSchema);
function worker(input: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'bun',
      [fileURLToPath(new URL('./messaging-data-worker.ts', import.meta.url))],
      { timeout: 20000, maxBuffer: 16384 },
      (error, stdout) => {
        if (error)
          return reject(new Error('Messaging browser data worker refused'));
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('Messaging browser data evidence invalid'));
        }
      },
    );
    child.stdin?.end(JSON.stringify(input));
  });
}
/** Signup objects also own browser contexts; transport only the declared account values. */
export function messagingBrowserSeedCommand(
  accounts: readonly { userId: string; username: string }[],
) {
  return {
    action: 'seed' as const,
    accounts: messagingBrowserSeedAccountsSchema.parse(
      accounts.map(({ userId, username }) => ({ userId, username })),
    ),
  };
}
export async function openMessagingBrowserData(
  accounts: readonly { userId: string; username: string }[],
) {
  const seeded = messagingBrowserAccountsSchema.parse(
    await worker(messagingBrowserSeedCommand(accounts)),
  );
  const channels: string[] = [];
  return {
    accounts: seeded,
    channels,
    async close() {
      const result = await worker({
        action: 'cleanup',
        accounts: seeded,
        channels,
      });
      if (result !== true)
        throw new Error('Messaging browser cleanup not proven');
    },
  };
}
