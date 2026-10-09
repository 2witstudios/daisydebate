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
  messagingBrowserTarget,
} from './messaging-data';
const command = z
  .discriminatedUnion('action', [
    z.strictObject({
      action: z.literal('seed'),
      accounts: z
        .array(
          z.strictObject({ userId: idSchema, username: z.string().min(1) }),
        )
        .min(1),
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
