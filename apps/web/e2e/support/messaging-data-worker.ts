import { SQL } from 'bun';
import { resolve } from 'node:path';
import { z } from 'zod';
import { systemClock } from '@daisy/clock';
import { idSchema } from '@daisy/protocol';
import {
  seedMessagingBrowserAccounts,
  cleanupMessagingBrowserData,
} from '@daisy/db/testing';
import {
  messagingBrowserAccountsSchema,
  messagingBrowserSeedAccountsSchema,
  messagingBrowserTarget,
} from './messaging-data';
/**
 * A refusal's cause for the test output: the error's own message and its
 * Postgres code and constraint, first line only and bounded. Never the
 * connection URL, the input or a stack.
 */
const refusalCause = (error: unknown): string => {
  const { message, code, constraint } = (error ?? {}) as {
    message?: unknown;
    code?: unknown;
    constraint?: unknown;
  };
  return [message, code, constraint]
    .filter((part): part is string => typeof part === 'string')
    .join(' · ')
    .split('\n')[0]!
    .replace(/[a-z]+:\/\/\S+/gi, '<url>')
    .slice(0, 240);
};
try {
  const command = z
    .discriminatedUnion('action', [
      z.strictObject({
        action: z.literal('seed'),
        accounts: messagingBrowserSeedAccountsSchema,
      }),
      z.strictObject({
        action: z.literal('cleanup'),
        accounts: messagingBrowserAccountsSchema,
        channels: z.array(idSchema),
      }),
    ])
    .parse(JSON.parse(await Bun.stdin.text()));
  const url = messagingBrowserTarget(
    process.env,
    resolve(import.meta.dirname, '../../../..'),
  );
  const client = new SQL(url, { max: 1 });
  try {
    const [identity] =
      await client`select current_database() as database,current_user as role`;
    if (
      identity?.database !== new URL(url).pathname.slice(1) ||
      identity?.role !== 'daisy_e2e'
    )
      throw new Error('Messaging browser connection identity refused');
    const result =
      command.action === 'seed'
        ? await seedMessagingBrowserAccounts(
            client,
            command.accounts,
            systemClock.now(),
          )
        : await cleanupMessagingBrowserData(
            client,
            command.accounts,
            command.channels,
          ).then(() => true);
    process.stdout.write(JSON.stringify(result));
  } finally {
    await client.close();
  }
} catch (error) {
  process.stderr.write(refusalCause(error));
  process.exitCode = 1;
}
