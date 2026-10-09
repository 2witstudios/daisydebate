import { SQL } from 'bun';
import { idSchema, buildUserInboxTopic } from '@daisy/protocol';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import config from '../../playwright.config';
import {
  deriveRecipientSubkey,
  recipientKey,
} from '../../src/features/auth/mail/recipient-key';

export type RoomAccountOwnership = {
  email: string;
  userId?: string | undefined;
  mailExpected: boolean;
  uncertain: boolean;
};
export type RoomAccountCounts = Readonly<Record<string, number>>;
export type RoomCleanupEvidence = {
  readonly before: RoomAccountCounts;
  readonly after: RoomAccountCounts;
};

const admissionSchema = z
  .object({
    version: z.literal(1),
    admitted: z.literal(true),
    target: z
      .object({
        database: z.string(),
        role: z.literal('daisy_e2e'),
        hostname: z.string(),
        port: z.string().regex(/^[1-9][0-9]{0,4}$/),
      })
      .strict(),
  })
  .strict();

/** Process denial, malformed metadata and mismatch all precede connect. */
export async function admitRoomCleanupConnection<
  T,
  E extends Readonly<Record<string, string | undefined>>,
>(
  env: E,
  request: (env: E) => Promise<string>,
  connect: (url: string) => T,
): Promise<T> {
  let url: URL;
  try {
    const snapshot = { ...env };
    url = new URL(snapshot.E2E_DATABASE_URL ?? '');
    const result = admissionSchema.parse(JSON.parse(await request(snapshot)));
    const expected = {
      database: decodeURIComponent(url.pathname.slice(1)),
      role: url.username,
      hostname: url.hostname,
      port: url.port || '5432',
    };
    if (
      Object.entries(expected).some(
        ([key, value]) => Reflect.get(result.target, key) !== value,
      )
    )
      throw new Error('mismatch');
  } catch {
    throw new Error('Room account cleanup admission refused');
  }
  return connect(url.toString());
}

function requestAdmission(env: NodeJS.ProcessEnv): Promise<string> {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const executable = fileURLToPath(
    new URL('../../../../scripts/room-account-admission.ts', import.meta.url),
  );
  return new Promise((resolve, reject) => {
    const child = execFile(
      'bun',
      [executable],
      { cwd: root, env, timeout: 10_000, maxBuffer: 4096 },
      (error, stdout) => {
        if (error) reject(new Error('Room account cleanup admission refused'));
        else resolve(stdout);
      },
    );
    child.stdin?.end(
      JSON.stringify({ version: 1, operation: 'admit-room-account-cleanup' }),
    );
  });
}

function isFixtureEmail(value: unknown): value is string {
  return (
    typeof value === 'string' && /^e2e[a-z0-9]{16}@example\.test$/.test(value)
  );
}

const cleanupInputSchema = z
  .object({
    action: z.enum(['inspect', 'clean']),
    accounts: z
      .array(
        z
          .object({
            email: z.custom<string>(isFixtureEmail),
            userId: idSchema.optional(),
            mailExpected: z.boolean(),
            uncertain: z.boolean(),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();

function ownedInput(value: unknown): {
  action: 'inspect' | 'clean';
  accounts: RoomAccountOwnership[];
} {
  const parsed = cleanupInputSchema.safeParse(value);
  if (!parsed.success) throw new Error('Room account cleanup input refused');
  const accounts = parsed.data.accounts.map((account) => ({
    ...account,
    userId: account.userId,
  }));
  if (
    new Set(accounts.map((account) => account.email)).size !==
      accounts.length ||
    accounts.some((account) => account.uncertain)
  )
    throw new Error('Room account cleanup activity unresolved');
  return { action: parsed.data.action, accounts };
}

/** Decode before invoking cleanup, whose first I/O is runner admission. */
export async function dispatchRoomCleanupRequest(
  value: unknown,
  invoke: (
    input: ReturnType<typeof ownedInput>,
  ) => Promise<RoomCleanupEvidence>,
): Promise<RoomCleanupEvidence> {
  return invoke(ownedInput(value));
}

function requireMailReceipts(
  accounts: readonly RoomAccountOwnership[],
  hashes: readonly string[],
  deliveries: readonly { recipient_hash: string }[],
) {
  accounts.forEach((account, index) => {
    if (
      account.mailExpected &&
      !deliveries.some((row) => row.recipient_hash === hashes[index])
    )
      throw new Error('Room account cleanup mail activity unresolved');
  });
}

const linkedTables = [
  'session',
  'account',
  'passkey',
  'member_interests',
  'member_topics',
  'member_onboarding',
] as const;

/** No imports from the integration fixture: that fixture owns a _test target. */
async function runCleanup(
  input: ReturnType<typeof ownedInput>,
): Promise<RoomCleanupEvidence> {
  const env = { ...process.env };
  const database = decodeURIComponent(
    new URL(env.E2E_DATABASE_URL ?? '').pathname.slice(1),
  );
  const servers = Array.isArray(config.webServer)
    ? config.webServer
    : [config.webServer];
  const secrets = servers
    .filter((server) => server?.name === 'production web')
    .map((server) => server?.env?.RECIPIENT_HASH_SECRET);
  if (
    secrets.length !== 1 ||
    typeof secrets[0] !== 'string' ||
    secrets[0].length < 64
  )
    throw new Error('Room account cleanup mail configuration refused');
  const subkey = deriveRecipientSubkey(secrets[0]);
  const sql = await admitRoomCleanupConnection(
    env,
    requestAdmission,
    (url) => new SQL(url, { max: 1 }),
  );
  try {
    const [identity] =
      await sql`SELECT current_database() AS database, current_user AS role`;
    if (identity?.database !== database || identity?.role !== 'daisy_e2e')
      throw new Error('Room account cleanup database identity refused');
    return await sql.begin(async (tx) => {
      const userIds: string[] = [];
      for (const owned of input.accounts) {
        const rows =
          (await tx`SELECT id, email FROM users WHERE email = ${owned.email}
          OR id = ${owned.userId ?? null} FOR UPDATE`) as Array<{
            id: string;
            email: string | null;
          }>;
        if (
          rows.length > 1 ||
          rows.some(
            (row) =>
              row.email !== owned.email ||
              (owned.userId !== undefined && row.id !== owned.userId),
          )
        )
          throw new Error('Room account cleanup ownership refused');
        if (rows[0]) userIds.push(rows[0].id);
        else if (owned.userId) userIds.push(owned.userId);
      }
      const actors =
        (await tx`SELECT id, kind FROM actors WHERE user_id = ANY(${tx.array(userIds, 'text')}::text[]) FOR UPDATE`) as Array<{
          id: string;
          kind: string;
        }>;
      if (actors.some((actor) => actor.kind !== 'human'))
        throw new Error('Room account cleanup actor ownership refused');
      const topics = actors.map((actor) => buildUserInboxTopic(actor.id));
      const emails = input.accounts.map((account) => account.email);
      const hashes = emails.map((email) => recipientKey(subkey, email));
      const deliveries =
        (await tx`SELECT provider_message_id, recipient_hash FROM email_delivery
        WHERE recipient_hash = ANY(${tx.array(hashes, 'text')}::text[]) FOR UPDATE`) as Array<{
          provider_message_id: string;
          recipient_hash: string;
        }>;
      requireMailReceipts(input.accounts, hashes, deliveries);
      const messageIds = deliveries.map(
        (delivery) => delivery.provider_message_id,
      );
      const counts = async (): Promise<RoomAccountCounts> => {
        const result: Record<string, number> = {};
        for (const table of ['users', 'actors', ...linkedTables]) {
          const column = table === 'users' ? 'id' : 'user_id';
          const [row] = await tx`SELECT count(*)::int AS count FROM ${tx(table)}
            WHERE ${tx(column)} = ANY(${tx.array(userIds, 'text')}::text[])`;
          result[table] = row.count;
        }
        const [other] = await tx`SELECT
          (SELECT count(*) FROM outbox WHERE topic = ANY(${tx.array(topics, 'text')}::text[]))::int AS outbox,
          (SELECT count(*) FROM verification WHERE CASE WHEN pg_input_is_valid(value, 'jsonb')
            THEN value::jsonb->>'email' END = ANY(${tx.array(emails, 'text')}::text[]))::int AS verification,
          (SELECT count(*) FROM email_delivery WHERE recipient_hash = ANY(${tx.array(hashes, 'text')}::text[]))::int AS delivery,
          (SELECT count(*) FROM email_delivery_event WHERE provider_message_id = ANY(${tx.array(messageIds, 'text')}::text[]))::int AS delivery_event,
          (SELECT count(*) FROM email_suppression WHERE recipient_hash = ANY(${tx.array(hashes, 'text')}::text[]))::int AS suppression`;
        return { ...result, ...other };
      };
      const before = await counts();
      if (input.action === 'clean') {
        await tx`DELETE FROM outbox WHERE topic = ANY(${tx.array(topics, 'text')}::text[])`;
        await tx`DELETE FROM actors WHERE user_id = ANY(${tx.array(userIds, 'text')}::text[])`;
        await tx`DELETE FROM users WHERE id = ANY(${tx.array(userIds, 'text')}::text[])`;
        // Better Auth 1.7.5 stores magic-link values as JSON {email,name}.
        // Exact field equality also preserves other addresses containing it.
        await tx`DELETE FROM verification WHERE CASE WHEN pg_input_is_valid(value, 'jsonb')
          THEN value::jsonb->>'email' END = ANY(${tx.array(emails, 'text')}::text[])`;
        await tx`DELETE FROM email_delivery_event WHERE provider_message_id = ANY(${tx.array(messageIds, 'text')}::text[])`;
        await tx`DELETE FROM email_delivery WHERE recipient_hash = ANY(${tx.array(hashes, 'text')}::text[])`;
        await tx`DELETE FROM email_suppression WHERE recipient_hash = ANY(${tx.array(hashes, 'text')}::text[])`;
      }
      return { before, after: await counts() };
    });
  } finally {
    await sql.close();
  }
}

if (import.meta.main) {
  try {
    // Bounded stdin; IDs/emails are not command arguments or output.
    let body = '';
    for await (const chunk of Bun.stdin.stream()) {
      body += new TextDecoder().decode(chunk);
      if (body.length > 8192)
        throw new Error('Room account cleanup input refused');
    }
    const result = await dispatchRoomCleanupRequest(
      JSON.parse(body),
      runCleanup,
    );
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const reason = message.includes('activity unresolved')
      ? 'pending'
      : message.includes('ownership refused')
        ? 'ownership'
        : message.includes('target refused') ||
            message.includes('identity refused')
          ? 'target'
          : message.includes('input refused')
            ? 'input'
            : message.includes('configuration refused')
              ? 'configuration'
              : typeof error === 'object' &&
                  error !== null &&
                  'errno' in error &&
                  error.errno === '23503'
                ? 'reference'
                : 'database';
    process.stderr.write(
      JSON.stringify({ error: 'ROOM_ACCOUNT_CLEANUP_REFUSED', reason }),
    );
    process.exitCode = 1;
  }
}
