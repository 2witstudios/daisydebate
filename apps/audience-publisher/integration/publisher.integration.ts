import { requireTestServices } from '@daisy/config';
import { validRules } from '@daisy/db/testing';
import { emptyRuntimeCheckpointFor } from '@daisy/protocol/round';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { createServer, type Socket } from 'node:net';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();
const { databaseUrl, redisUrl } = requireTestServices(process.env);

/** A public bucket that records each request and answers every one. */
const fakeBucket = () => {
  const requests: string[] = [];
  const deleted = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      requests.push(request.method);
      await request.arrayBuffer();
      if (request.method === 'DELETE') deleted.resolve();
      if (request.method === 'GET') return new Response(null, { status: 404 });
      return new Response(null);
    },
  });
  return { server, requests, deleted: deleted.promise };
};

const spawnPublisher = (databaseUrlFor: string, bucketOrigin: string) =>
  Bun.spawn([process.execPath, 'src/start.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AUDIENCE_PUBLISHER_DATABASE_URL: databaseUrlFor,
      BROADCAST_STORAGE_ENDPOINT: bucketOrigin,
      BROADCAST_PUBLIC_BUCKET: 'public',
      BROADCAST_PUBLIC_KEY: 'test',
      BROADCAST_PUBLIC_SECRET: 'test',
      BROADCAST_PUBLIC_ORIGIN: 'https://watch.example.test',
      REDIS_URL: redisUrl,
      REDIS_NAMESPACE: `audience-${createId()}`,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

/** How the process ended within `ms` of the signal, or null if it had not. */
const exitWithin = async (
  child: ReturnType<typeof spawnPublisher>,
  ms: number,
) =>
  Promise.race([
    child.exited.then((code) => ({ code })),
    Bun.sleep(ms).then(() => null),
  ]);

test('the actual process withdraws an over Broadcast and drains on SIGTERM', async () => {
  const sql = new SQL(databaseUrl, { max: 1 });
  const roundId = createId();
  const broadcastId = createId();
  const role = `audience_${createId()}`;
  const password = createId();
  const bucket = fakeBucket();
  let child: ReturnType<typeof spawnPublisher> | undefined;
  let roleCreated = false;
  const endedAt = new Date(Date.now() - 2 * 24 * 60 * 60_000);
  try {
    await sql`insert into rounds (id, competition_type, format_id, format_version, rules_snapshot, runtime_state, status, resolution, visibility)
      values (${roundId}, 'casual', 'freestyle', 1, ${JSON.stringify(validRules)}::text::jsonb,
        ${JSON.stringify(emptyRuntimeCheckpointFor(validRules))}::text::jsonb, 'opening', 'A resolution', 'public')`;
    await sql`insert into broadcasts (id, round_id, feed_key, release_policy, created_at, stopped_at, stop_reason)
      values (${broadcastId}, ${roundId}, ${broadcastId}, ${JSON.stringify({ kind: 'delay', seconds: 60 })}::text::jsonb,
        ${endedAt}, ${endedAt}, 'technical')`;
    // Generated identifiers and the password are lowercase alphanumerics only.
    await sql.unsafe(
      `create role ${role} login password '${password}' in role daisy_audience_publisher`,
    );
    roleCreated = true;
    const url = new URL(databaseUrl);
    url.username = role;
    url.password = password;
    const publisher = spawnPublisher(url.href, bucket.server.url.origin);
    child = publisher;
    await Promise.race([
      bucket.deleted,
      publisher.exited.then(async (code) => {
        throw new Error(
          `Publisher exited first: ${code}: ${await new Response(publisher.stderr).text()}`,
        );
      }),
      Bun.sleep(15_000).then(() => {
        throw new Error('The publisher never withdrew the state');
      }),
    ]);
    // The withdrawal is recorded after the delete answers.
    let withdrawn: unknown = null;
    for (let attempt = 0; attempt < 50 && withdrawn === null; attempt += 1) {
      const [row] =
        await sql`select audience_state_withdrawn_at from broadcasts where id=${broadcastId}`;
      withdrawn = row?.audience_state_withdrawn_at ?? null;
      if (withdrawn === null) await Bun.sleep(100);
    }
    publisher.kill('SIGTERM');
    const drained = await exitWithin(publisher, 5_000);
    assert({
      given:
        'a public Broadcast stopped two days ago, past its six-hour window',
      should:
        'delete its public state, record the withdrawal, and exit cleanly on SIGTERM',
      actual: {
        deleted: bucket.requests.includes('DELETE'),
        withdrawn: withdrawn !== null,
        drained,
      },
      expected: { deleted: true, withdrawn: true, drained: { code: 0 } },
    });
  } finally {
    if (child) {
      child.kill('SIGKILL');
      await child.exited;
    }
    bucket.server.stop(true);
    await sql`delete from broadcasts where id=${broadcastId}`;
    await sql`delete from rounds where id=${roundId}`;
    if (roleCreated) await sql.unsafe(`drop role ${role}`);
    await sql.close();
  }
}, 30_000);

test('SIGTERM during a store read that never answers still exits within its drain bound', async () => {
  // A database that accepts connections and never says a word.
  const sockets = new Set<Socket>();
  const silent = createServer((socket) => {
    sockets.add(socket);
  });
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const address = silent.address();
  if (address === null || typeof address === 'string')
    throw new Error('no port');
  const bucket = fakeBucket();
  const stalled = `postgres://stalled:stalled@127.0.0.1:${address.port}/stalled`;
  const publisher = spawnPublisher(stalled, bucket.server.url.origin);
  try {
    // Long enough for the first pass to be waiting on the silent store.
    await Bun.sleep(1_500);
    publisher.kill('SIGTERM');
    const drained = await exitWithin(publisher, 12_000);
    assert({
      given: 'a pass stuck on a store that never answers',
      should: 'still exit on SIGTERM within the drain bound, not hang',
      actual: drained !== null,
      expected: true,
    });
  } finally {
    publisher.kill('SIGKILL');
    await publisher.exited;
    for (const socket of sockets) socket.destroy();
    silent.close();
    bucket.server.stop(true);
  }
}, 30_000);
