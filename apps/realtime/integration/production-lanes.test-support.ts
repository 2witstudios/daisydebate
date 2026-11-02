import { SQL } from 'bun';
import { systemId } from '@daisy/clock';
import { createRealtimeDatabase } from '@daisy/db';
import { requireTestServices } from '@daisy/config';
import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '@daisy/protocol';
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
import { testOrigin } from './support';

const instant = '2026-10-09T00:00:00.000Z';

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
  const waiters = new Set<{ readonly ms: number; readonly fire: () => void }>();
  const resources = createRealtimeApp({
    database: createRealtimeDatabase({
      url: services.databaseUrl,
      ...(realWaiters
        ? {}
        : {
            laneTimer: (ms: number, fire: () => void) => {
              const waiter = { ms, fire };
              waiters.add(waiter);
              return () => {
                waiters.delete(waiter);
              };
            },
          }),
    }),
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: services.databaseUrl,
      REDIS_URL: services.redisUrl,
      REDIS_NAMESPACE: testNamespace(systemId.next()),
      LOG_LEVEL: 'silent',
      REALTIME_ALLOWED_ORIGINS: testOrigin,
    },
    clock: { now: () => instant },
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
  let revalidate: (() => void) | undefined;
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
      timers: {
        setInterval: (callback, ms) => {
          if (ms === 50_000) revalidate = callback;
          return setInterval(callback, ms);
        },
        clearInterval,
      },
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
      revalidate: () => revalidate?.(),
      /** Fires each queued lane waiter whose bound is at most `elapsedMs`. */
      expireWaiters(elapsedMs) {
        for (const waiter of [...waiters])
          if (waiter.ms <= elapsedMs) {
            waiters.delete(waiter);
            waiter.fire();
          }
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
