import { readFileSync } from 'node:fs';
import { SQL } from 'bun';
import { percentile } from './report';

/** Linux's cumulative steal share, or null where /proc/stat does not exist. */
const stealTicks = () => {
  try {
    const cpu = readFileSync('/proc/stat', 'utf8').split('\n')[0]!;
    const ticks = cpu.trim().split(/\s+/).slice(1).map(Number);
    return { steal: ticks[7] ?? 0, total: ticks.reduce((a, b) => a + b, 0) };
  } catch {
    return null;
  }
};

/**
 * PostgreSQL as its own views report it, once a second, on one connection of
 * its own. CPU steal is this host's: on a rig the driver shares no CPU with the
 * server, so it says only what the driver's machine lost.
 */
export function startSystemSampler(databaseUrl: string) {
  const client = new SQL(databaseUrl, { max: 1 });
  const connections: number[] = [];
  const lockWaits: number[] = [];
  const stealStart = stealTicks();
  let failed = 0;
  const timer = setInterval(() => {
    client`
      select
        (select count(*)::int from pg_stat_activity
          where datname = current_database() and pid <> pg_backend_pid()) as connections,
        (select count(*)::int from pg_locks where not granted) as lock_waits
    `
      .then(([row]: { connections: number; lock_waits: number }[]) => {
        connections.push(row!.connections);
        lockWaits.push(row!.lock_waits);
      })
      .catch(() => {
        failed += 1;
      });
  }, 1_000);
  return {
    async stop() {
      clearInterval(timer);
      const stealEnd = stealTicks();
      await client.close({ timeout: 5 });
      return {
        samples: connections.length,
        failedSamples: failed,
        connectionsP95: percentile(connections, 95),
        connectionsMax: connections.length ? Math.max(...connections) : null,
        lockWaitsP95: percentile(lockWaits, 95),
        lockWaitsMax: lockWaits.length ? Math.max(...lockWaits) : null,
        cpuStealShare:
          stealStart && stealEnd && stealEnd.total > stealStart.total
            ? (stealEnd.steal - stealStart.steal) /
              (stealEnd.total - stealStart.total)
            : null,
      };
    },
  };
}
