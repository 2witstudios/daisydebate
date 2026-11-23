import { SQL } from 'bun';
import { systemId } from '@daisy/clock';
import type { Waits } from '@daisy/clock';
import { createRealtimeDatabase, WORKLOAD_PROFILES } from '@daisy/db';
import { hostWaits } from '@daisy/worker/host';
import { requireTestServices } from '@daisy/config';
import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '@daisy/protocol/realtime';
import { testNamespace } from '@daisy/redis/testing';
import { createRealtimeApp } from '../src/app';
import { refuseAllReading } from '../src/authorization.test-support';
import { serveRealtime } from '../src/serve';
import { openAuthorityPeer } from './authority-peer.test-support';
import { roundAudienceFixture } from './round-audience.test-support';
import {
  authorityParticipant,
  issueAuthorityTicket,
} from './socket-authority.test-support';
import { heldCadence, testOrigin } from './support';

const instant = '2026-10-09T00:00:00.000Z';

type LaneWaiter = { readonly ms: number; readonly fire: () => void };

/** Every realtime lane's waiter bound: the waits `expireWaiters` ends by hand. */
const laneBounds = new Set(
  Object.values(WORKLOAD_PROFILES.realtime.lanes).map(
    (budget) => budget.maxWaitMs,
  ),
);

/**
 * Host time, except that a wait as long as a lane's waiter bound is queued
 * in `waiters` and ends only when fired: firing moves this clock to the
 * wait's end, so the lane sees its bound reached. Every other wait (a
 * connection bound, a sampler deadline) runs on the host.
 */
function heldLaneWaits(waiters: Set<LaneWaiter>): Waits {
  let skippedMs = 0;
  const nowMs = () => hostWaits.nowMs() + skippedMs;
  const waitUntilMs = (dueMs: number, signal?: AbortSignal) => {
    const ms = Math.round(dueMs - nowMs());
    if (!laneBounds.has(ms))
      return hostWaits.waitUntilMs(dueMs - skippedMs, signal);
    return new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const done = () => {
        waiters.delete(waiter);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const waiter: LaneWaiter = {
        ms,
        fire: () => {
          skippedMs = Math.max(skippedMs, dueMs - hostWaits.nowMs());
          done();
        },
      };
      signal?.addEventListener('abort', done, { once: true });
      waiters.add(waiter);
    });
  };
  return {
    nowMs,
    waitUntilMs,
    sleep: (ms, signal) => waitUntilMs(nowMs() + Math.max(0, ms), signal),
  };
}

/**
 * The production lane pools and session bounds on the real socket and
 * PostgreSQL, under the test database role, since a role cannot be set on a
 * pool. Lane waiters expire only when `expireWaiters` says so, unless a test
 * asks for the real waiter timer.
 */
export async function productionLanes(
  run: (world: LaneWorld) => Promise<void>,
  { realWaiters = false } = {},
) {
  const services = requireTestServices(process.env);
  const admin = new SQL(services.databaseUrl);
  const waiters = new Set<LaneWaiter>();
  const waits = realWaiters ? hostWaits : heldLaneWaits(waiters);
  const resources = createRealtimeApp({
    database: createRealtimeDatabase({ url: services.databaseUrl, waits }),
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: services.databaseUrl,
      REDIS_URL: services.redisUrl,
      REDIS_NAMESPACE: testNamespace(systemId.next()),
      LOG_LEVEL: 'silent',
      REALTIME_ALLOWED_ORIGINS: testOrigin,
    },
    clock: { now: () => instant },
    waits,
  });
  const causes: unknown[] = [];
  const log = resources.logger.log;
  (resources.logger as { log: typeof log }).log = (event, fields, message) => {
    if (event === 'realtime.subscription.unavailable')
      causes.push(fields?.cause);
    log(event, fields, message);
  };
  const debater = authorityParticipant(admin);
  const fenced = authorityParticipant(admin);
  const rounds = roundAudienceFixture(admin, debater.actorId);
  const revalidation = heldCadence(50_000);
  let runtime: Awaited<ReturnType<typeof serveRealtime>> | undefined;
  try {
    await debater.seed();
    await fenced.seed();
    runtime = await serveRealtime({
      resources,
      readingPolicy: refuseAllReading,
      port: 0,
      hostname: '127.0.0.1',
      now: () => 0,
      waits: revalidation.waits,
    });
    const port = runtime.server.port!;
    const ticket = (participant: typeof debater) =>
      issueAuthorityTicket({ resources, ...participant });
    await run({
      admin,
      debater,
      fenced,
      rounds,
      ticket,
      port,
      causes,
      connect: async (participant) =>
        openAuthorityPeer(port, await ticket(participant)),
      revalidate: () => void revalidation.fire(),
      /** Fires each queued lane waiter whose bound is at most `elapsedMs`. */
      expireWaiters(elapsedMs) {
        for (const waiter of [...waiters])
          if (waiter.ms <= elapsedMs) waiter.fire();
      },
      queuedBounds: () => [...waiters].map(({ ms }) => ms),
    });
  } finally {
    await runtime?.close();
    await resources.close();
    await rounds.close();
    await fenced.erase();
    await debater.erase();
    await admin.close();
  }
}
export type LaneWorld = {
  readonly admin: SQL;
  readonly debater: ReturnType<typeof authorityParticipant>;
  readonly fenced: ReturnType<typeof authorityParticipant>;
  readonly rounds: ReturnType<typeof roundAudienceFixture>;
  readonly ticket: (
    participant: ReturnType<typeof authorityParticipant>,
  ) => Promise<string>;
  readonly port: number;
  /** The `cause` of each `realtime.subscription.unavailable` logged. */
  readonly causes: readonly unknown[];
  readonly connect: (
    participant: ReturnType<typeof authorityParticipant>,
  ) => ReturnType<typeof openAuthorityPeer>;
  readonly revalidate: () => void;
  readonly expireWaiters: (elapsedMs: number) => void;
  readonly queuedBounds: () => readonly number[];
};

/** Holds one participant's account fence while `work` runs, with this writer's pid. */
export const holdingFence = <T>(
  world: LaneWorld,
  work: (blocked: () => Promise<void>) => Promise<T>,
) =>
  world.admin.begin(async (writer) => {
    const [holder] = await writer`select pg_backend_pid()::int as pid`;
    await writer`select id from users where id=${world.fenced.userId} for update`;
    return work(async () => {
      for (let polls = 0; polls < 250; polls += 1) {
        const [row] = await world.admin`
          select count(*)::int as waiting from pg_stat_activity
          where ${holder.pid}::int = any(pg_blocking_pids(pid))`;
        if (row.waiting > 0) return;
        await Bun.sleep(20);
      }
      throw new Error('No read reached the held fence');
    });
  });

/** A socket that sends its hello and may never be answered `ready`. */
export function sendHello(port: number, ticket: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: { origin: testOrigin },
  });
  socket.addEventListener('open', () =>
    socket.send(
      JSON.stringify({
        v: ENVELOPE_VERSION,
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        ticket,
      }),
    ),
  );
  return {
    socket,
    closed: new Promise<number>((accept) =>
      socket.addEventListener('close', (event) => accept(event.code)),
    ),
  };
}
