/**
 * `bun slot:up | slot:down | slot:prune` (ADR 0034): per-checkout databases
 * and Redis namespaces on the one shared local stack.
 *
 *   up     bring the shared stack up, prune orphans, create and migrate this
 *          checkout's databases from the template, write its .env values.
 *          Idempotent: a second run changes nothing.
 *   down   drop this worktree's databases and Redis keys (refused on main).
 *   prune  drop the databases and Redis keys of worktrees git no longer lists.
 *
 * The server comes from the checkout's .env URLs (host, port, credentials),
 * which is how the admin connection is injected. `--checkout <path>` and
 * `--env <path>` select another checkout and .env file; Compose honours
 * COMPOSE_FILE and COMPOSE_PROJECT_NAME when set.
 */
import { RedisClient, SQL } from 'bun';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createSlotDatabase,
  dropSlotDatabase,
  ensureE2ERole,
  ensureTemplate,
  listSlotDatabases,
  setSlotDatabaseComment,
  withSlotLock,
} from '@daisy/db/slots';
import { deleteNamespace, listNamespaces } from '@daisy/redis/namespaces';
import {
  deriveSlot,
  e2eRedisUrl,
  e2eRole,
  findOrphans,
  liveWorktreeIds,
  parsePortBlockComment,
  parseWorktreeList,
  pickPortBlock,
  portBlockComment,
  portBlockPorts,
  readEnvValue,
  rewriteEnv,
  slotEnvValues,
  type Slot,
} from './slot-model';

const root = resolve(import.meta.dir, '..');
const template = 'daisy_template';
const worktreeDatabases = 'daisy_wt_';
const worktreeNamespaces = 'daisy-wt-';

const run = async (
  command: readonly string[],
  cwd: string,
  env?: Record<string, string | undefined>,
): Promise<string> => {
  const child = Bun.spawn([...command], {
    cwd,
    env: env ?? process.env,
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0)
    throw new Error(`${command.slice(0, 3).join(' ')} failed`);
  return output;
};

const realOrSame = (path: string) => realpath(path).catch(() => path);

export type Checkout = {
  readonly path: string;
  readonly slot: Slot;
  /** Slot ids of every live worktree of this repository, this one included. */
  readonly liveIds: readonly string[];
};

export async function resolveCheckout(start: string): Promise<Checkout> {
  const path = await realOrSame(
    (await run(['git', 'rev-parse', '--show-toplevel'], start)).trim(),
  );
  const list = parseWorktreeList(
    await run(['git', 'worktree', 'list', '--porcelain'], path),
  );
  const mainCheckout = await realOrSame(list.main);
  const worktrees = await Promise.all(list.worktrees.map(realOrSame));
  const slot = deriveSlot({ checkout: path, mainCheckout });
  const { ids } = liveWorktreeIds(worktrees);
  return {
    path,
    slot,
    liveIds: slot.kind === 'worktree' ? [...new Set([...ids, slot.id])] : ids,
  };
}

const withDatabase = (url: string, database: string) => {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
};

export type SlotServices = {
  readonly admin: SQL;
  readonly connect: (database: string) => SQL;
  /** The dev (REDIS_URL) and e2e Redis databases every slot writes to. */
  readonly redis: readonly RedisClient[];
  readonly close: () => Promise<void>;
};

export function openServices(
  env: Readonly<Record<string, string | undefined>>,
): SlotServices {
  if (!env.DATABASE_URL || !env.REDIS_URL)
    throw new Error('DATABASE_URL and REDIS_URL are required in .env');
  const server = env.DATABASE_URL;
  const connect = (database: string) =>
    new SQL(withDatabase(server, database), { max: 1, connectionTimeout: 5 });
  const admin = connect('postgres');
  const redisUrls = [
    ...new Set([
      env.REDIS_URL,
      env.E2E_REDIS_URL ?? e2eRedisUrl(env.REDIS_URL),
    ]),
  ];
  const redis = redisUrls.map((url) => new RedisClient(url));
  return {
    admin,
    connect,
    redis,
    close: async () => {
      for (const client of redis) client.close();
      await admin.close({ timeout: 5 });
    },
  };
}

export async function inspectOrphans(
  services: SlotServices,
  liveIds: readonly string[],
) {
  const databases = (
    await listSlotDatabases(services.admin, worktreeDatabases)
  ).map(({ name }) => name);
  const namespaces = [
    ...new Set(
      (
        await Promise.all(
          services.redis.map((client) =>
            listNamespaces(client, worktreeNamespaces),
          ),
        )
      ).flat(),
    ),
  ];
  return findOrphans({ liveIds, databases, namespaces });
}

async function prune(services: SlotServices, liveIds: readonly string[]) {
  const orphans = await inspectOrphans(services, liveIds);
  for (const database of orphans.databases)
    await dropSlotDatabase(services.admin, database);
  for (const namespace of orphans.namespaces)
    for (const client of services.redis)
      await deleteNamespace(client, namespace);
  return orphans;
}

const isPortFree = (port: number): boolean => {
  try {
    const listener = Bun.listen({
      hostname: '127.0.0.1',
      port,
      socket: { data() {} },
    });
    listener.stop(true);
    return true;
  } catch {
    return false;
  }
};

async function claimPortBlock(admin: SQL, slot: Slot): Promise<number> {
  const databases = await listSlotDatabases(admin, worktreeDatabases);
  const own = parsePortBlockComment(
    databases.find(({ name }) => name === slot.database)?.comment,
  );
  const claimed = databases
    .filter(({ name }) => name !== slot.database)
    .map(({ comment }) => parsePortBlockComment(comment))
    .filter((block): block is number => block !== undefined);
  const block = pickPortBlock({
    own,
    claimed,
    isFree: (candidate) => portBlockPorts(candidate).every(isPortFree),
  });
  if (own === undefined)
    await setSlotDatabaseComment(admin, slot.database, portBlockComment(block));
  return block;
}

export async function migrate(databaseUrl: string): Promise<void> {
  await run(['bun', 'packages/db/scripts/migrate.ts'], root, {
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
}

async function readEnvFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    throw new Error(`${path} is missing: copy .env.example to .env first`);
  }
}

const envOf = (content: string) => ({
  DATABASE_URL: readEnvValue(content, 'DATABASE_URL'),
  TEST_DATABASE_URL: readEnvValue(content, 'TEST_DATABASE_URL'),
  REDIS_URL: readEnvValue(content, 'REDIS_URL'),
  E2E_REDIS_URL: readEnvValue(content, 'E2E_REDIS_URL'),
});

const describeOrphans = (ids: readonly string[]) =>
  ids.length === 0 ? 'none' : ids.join(', ');

async function up(checkout: Checkout, envPath: string) {
  const content = await readEnvFile(envPath);
  const env = envOf(content);
  await run(['docker', 'compose', 'up', '-d', '--wait'], root, {
    ...process.env,
    COMPOSE_FILE: process.env.COMPOSE_FILE ?? 'infra/compose.yaml',
  });
  const services = openServices(env);
  try {
    const { slot } = checkout;
    const { pruned, created, portBlock } = await withSlotLock(
      services.admin,
      async () => {
        const pruned = await prune(services, checkout.liveIds);
        await ensureE2ERole(services.admin, e2eRole);
        await ensureTemplate({
          admin: services.admin,
          connect: services.connect,
          template,
          e2eUser: e2eRole.user,
        });
        const created: string[] = [];
        for (const database of [slot.database, slot.testDatabase])
          if (await createSlotDatabase(services.admin, database, template))
            created.push(database);
        const portBlock =
          slot.kind === 'worktree'
            ? await claimPortBlock(services.admin, slot)
            : undefined;
        return { pruned, created, portBlock };
      },
    );
    const values = slotEnvValues({ slot, env, portBlock });
    const rewritten = rewriteEnv(content, values);
    if (rewritten.changed) await writeFile(envPath, rewritten.content);
    await migrate(values.DATABASE_URL ?? '');
    await migrate(values.TEST_DATABASE_URL ?? '');
    process.stdout.write(
      [
        `Slot ${slot.id} (${slot.kind})`,
        `  databases: ${slot.database}, ${slot.testDatabase} (created: ${created.join(', ') || 'none'}; migrated)`,
        `  redis namespaces: ${slot.namespace}, ${slot.e2eNamespace}`,
        `  ports: app ${values.PORT}, e2e ${values.E2E_PORT}`,
        `  .env: ${rewritten.changed ? 'updated' : 'unchanged'}`,
        `  pruned orphan slots: ${describeOrphans(pruned.ids)}`,
        '',
      ].join('\n'),
    );
  } finally {
    await services.close();
  }
}

async function down(checkout: Checkout, envPath: string) {
  const { slot } = checkout;
  if (slot.kind === 'main')
    throw new Error(
      'slot:down refuses the main checkout: its databases are the shared defaults',
    );
  const services = openServices(envOf(await readEnvFile(envPath)));
  try {
    const removed = await withSlotLock(services.admin, async () => {
      for (const database of [slot.database, slot.testDatabase])
        await dropSlotDatabase(services.admin, database);
      let removed = 0;
      for (const client of services.redis)
        for (const namespace of [slot.namespace, slot.e2eNamespace])
          removed += await deleteNamespace(client, namespace);
      return removed;
    });
    process.stdout.write(
      `Slot ${slot.id}: dropped ${slot.database}, ${slot.testDatabase}; deleted ${removed} Redis keys\n`,
    );
  } finally {
    await services.close();
  }
}

async function pruneCommand(checkout: Checkout, envPath: string) {
  const services = openServices(envOf(await readEnvFile(envPath)));
  try {
    const pruned = await withSlotLock(services.admin, () =>
      prune(services, checkout.liveIds),
    );
    process.stdout.write(
      `Pruned orphan slots: ${describeOrphans(pruned.ids)}\n`,
    );
  } finally {
    await services.close();
  }
}

async function main(argv: readonly string[]) {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { checkout: { type: 'string' }, env: { type: 'string' } },
  });
  const command = positionals[0];
  const commands = { up, down, prune: pruneCommand } as const;
  if (command !== 'up' && command !== 'down' && command !== 'prune')
    throw new Error(
      'Usage: bun scripts/slot.ts up|down|prune [--checkout <path>] [--env <path>]',
    );
  const checkout = await resolveCheckout(values.checkout ?? root);
  await commands[command](
    checkout,
    values.env ? resolve(values.env) : join(checkout.path, '.env'),
  );
}

if (import.meta.main) {
  try {
    await main(Bun.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'slot command failed'}\n`,
    );
    process.exitCode = 1;
  }
}
