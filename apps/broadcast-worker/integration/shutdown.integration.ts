import { requireTestServices } from '@daisy/config';
import { validRules } from '@daisy/db/testing';
import { emptyRuntimeCheckpointFor } from '@daisy/protocol/round';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('SIGTERM drains the actual broadcast process during an active encode', async () => {
  const sql = new SQL(databaseUrl, { max: 1 });
  const id = createId();
  const roundId = createId();
  const role = `encoder_${createId()}`;
  const password = createId();
  const dir = await mkdtemp(join(tmpdir(), 'broadcast-shutdown-'));
  const began = Promise.withResolvers<number>();
  const release = Promise.withResolvers<Response>();
  const writes: string[] = [];
  const capturedAt = Date.now() - 120_000;
  const playlist = `#EXTM3U\n#EXT-X-PROGRAM-DATE-TIME:${new Date(capturedAt).toISOString()}\n#EXTINF:4.0,\ns_0.ts\n`;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/encoder') {
        began.resolve(Number(await request.text()));
        return release.promise;
      }
      if (request.method === 'PUT') {
        await request.arrayBuffer();
        writes.push(path);
        return new Response(null);
      }
      const body = path.endsWith('p.m3u8') ? playlist : 'held segment';
      return new Response(request.method === 'HEAD' ? null : body, {
        headers: { 'content-length': String(Buffer.byteLength(body)) },
      });
    },
  });
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let encoderPid: number | undefined;
  let roleCreated = false;
  try {
    await sql`insert into rounds (id, competition_type, format_id, format_version, rules_snapshot, runtime_state, status, resolution)
      values (${roundId}, 'casual', 'freestyle', 1, ${JSON.stringify(validRules)}::text::jsonb,
        ${JSON.stringify(emptyRuntimeCheckpointFor(validRules))}::text::jsonb, 'opening', 'A resolution')`;
    await sql`insert into broadcasts (id, round_id, feed_key, release_policy, created_at,
      control_heartbeat_at, egress_generation, egress_started_at)
      values (${id}, ${roundId}, ${id}, ${JSON.stringify({ kind: 'delay', seconds: 60 })}::text::jsonb,
        ${new Date(capturedAt)}, clock_timestamp(), 1, ${new Date(capturedAt)})`;
    await sql`insert into round_segments (id, round_id, sequence, type, rules_segment_key, started_at, ended_at, duration_ms)
      values (${createId()}, ${roundId}, 0, 'speech', 'AC', ${new Date(capturedAt)}, ${new Date(capturedAt + 4000)}, 240000)`;
    // Generated identifiers/password contain only lowercase alphanumerics.
    await sql.unsafe(
      `create role ${role} login password '${password}' in role daisy_broadcast_worker`,
    );
    roleCreated = true;
    const workerUrl = new URL(databaseUrl);
    workerUrl.username = role;
    workerUrl.password = password;
    await Bun.write(
      join(dir, 'ffmpeg'),
      `#!${process.execPath}\nimport ${JSON.stringify(resolve('integration/stalled-encoder.test-support.ts'))};\n`,
    );
    await chmod(join(dir, 'ffmpeg'), 0o700);
    const worker = Bun.spawn([process.execPath, 'src/start.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        ENCODER_TEST_ENDPOINT: server.url.origin,
        BROADCAST_WORKER_DATABASE_URL: workerUrl.href,
        BROADCAST_STORAGE_ENDPOINT: server.url.origin,
        BROADCAST_HOLD_BUCKET: 'hold',
        BROADCAST_HOLD_KEY: 'test',
        BROADCAST_HOLD_SECRET: 'test',
        BROADCAST_PUBLIC_BUCKET: 'public',
        BROADCAST_PUBLIC_KEY: 'test',
        BROADCAST_PUBLIC_SECRET: 'test',
        BROADCAST_WORKER_SLOTS: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    child = worker;
    encoderPid = await Promise.race([
      began.promise,
      worker.exited.then(async (code) => {
        throw new Error(
          `Worker exited before encode: ${code}: ${await new Response(worker.stderr).text()}`,
        );
      }),
      Bun.sleep(10_000).then(() => {
        throw new Error('Actual worker never entered encoding');
      }),
    ]);
    const before = [...writes];
    const started = performance.now();
    worker.kill('SIGTERM');
    const drained = await Promise.race([
      worker.exited.then((code) => ({ code })),
      Bun.sleep(8000).then(() => null),
    ]);
    let encoderAlive = true;
    try {
      process.kill(encoderPid, 0);
    } catch {
      encoderAlive = false;
    }
    assert({
      given:
        'SIGTERM after the actual process has claimed and spawned a stalled encoder',
      should:
        'exit successfully well within Fly’s 30s grace, reap the encoder and publish nothing further',
      actual: {
        drained,
        withinGrace: performance.now() - started < 30_000,
        encoderAlive,
        writes,
        before,
      },
      expected: {
        drained: { code: 0 },
        withinGrace: true,
        encoderAlive: false,
        writes: before,
        before,
      },
    });
    const [row] =
      await sql`select next_segment, hold_cursor from broadcasts where id=${id}`;
    assert({
      given: 'a cancelled encoding attempt',
      should: 'leave the durable cursor unchanged for the next owner',
      actual: { ...row },
      expected: { next_segment: 0, hold_cursor: 0 },
    });
  } finally {
    release.resolve(new Response(null));
    if (child) {
      child.kill('SIGKILL');
      await child.exited;
    }
    if (encoderPid) {
      try {
        process.kill(encoderPid, 'SIGKILL');
      } catch {
        /* Already reaped. */
      }
    }
    server.stop(true);
    await sql`delete from broadcasts where id=${id}`;
    await sql`delete from rounds where id=${roundId}`;
    if (roleCreated) await sql.unsafe(`drop role ${role}`);
    await sql.close();
    await rm(dir, { recursive: true, force: true });
    await rm(join(tmpdir(), 'broadcast-worker', id), {
      recursive: true,
      force: true,
    });
  }
}, 30_000);
