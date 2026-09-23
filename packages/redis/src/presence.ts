import type { RedisClient } from 'bun';
import type { PresenceActivity } from '@daisy/protocol';
import { redisKey } from './redis-key';
import {
  assertActorId,
  assertKeySegment,
  assertLimit,
  assertTtlSeconds,
  createScriptRunner,
  deletePresenceLeaseScript,
  parseActivity,
  readActorConnectionsScript,
  readOnlinePresenceScript,
  refreshPresenceLeaseScript,
  sweepOnlinePresenceScript,
  upsertPresenceLeaseScript,
} from './presence-scripts';

export type { PresenceActivity };
export type PresenceLease = {
  readonly connId: string;
  readonly actorId: string;
  readonly instanceId: string;
};
export type PresenceConnection = {
  readonly connId: string;
  readonly actorId: string;
  readonly activity: PresenceActivity;
  readonly instanceId: string;
  readonly expiresAtMs: number;
};
export type PresenceOnlineActor = {
  readonly actorId: string;
  readonly expiresAtMs: number;
};

export function createPresenceOperations({
  client,
  namespace,
  reportFailure,
}: {
  readonly client: RedisClient;
  readonly namespace: string;
  readonly reportFailure: (operation: string) => void;
}) {
  const runScript = createScriptRunner(client);
  return {
    /** Atomic upsert of one connection's presence lease with a mandatory TTL. */
    async upsertPresenceLease(
      lease: PresenceLease & { readonly activity: PresenceActivity },
      ttlSeconds: number,
    ) {
      assertKeySegment('connId', lease.connId);
      assertActorId(lease.actorId);
      assertKeySegment('instanceId', lease.instanceId);
      const activity = parseActivity(lease.activity);
      assertTtlSeconds(ttlSeconds);
      try {
        await client.connect();
        await runScript(upsertPresenceLeaseScript, 3, [
          redisKey(namespace, 'presence', 'conn', lease.connId),
          redisKey(namespace, 'presence', 'actor', lease.actorId),
          redisKey(namespace, 'presence', 'online'),
          lease.actorId,
          activity,
          lease.instanceId,
          String(ttlSeconds * 1000),
          lease.connId,
        ]);
      } catch (error) {
        reportFailure('upsertPresenceLease');
        throw error;
      }
    },
    /**
     * Extends an existing lease. Returns `refreshed: false` without error
     * when the lease already expired: the caller must re-upsert.
     */
    async refreshPresenceLease(
      lease: Pick<PresenceLease, 'connId' | 'actorId'>,
      ttlSeconds: number,
    ) {
      assertKeySegment('connId', lease.connId);
      assertActorId(lease.actorId);
      assertTtlSeconds(ttlSeconds);
      try {
        await client.connect();
        const refreshed = (await runScript(refreshPresenceLeaseScript, 3, [
          redisKey(namespace, 'presence', 'conn', lease.connId),
          redisKey(namespace, 'presence', 'actor', lease.actorId),
          redisKey(namespace, 'presence', 'online'),
          String(ttlSeconds * 1000),
          lease.connId,
          lease.actorId,
        ])) as number;
        return { refreshed: refreshed === 1 };
      } catch (error) {
        reportFailure('refreshPresenceLease');
        throw error;
      }
    },
    /** Atomic delete of one connection's presence lease (a clean disconnect). */
    async deletePresenceLease(
      lease: Pick<PresenceLease, 'connId' | 'actorId'>,
    ) {
      assertKeySegment('connId', lease.connId);
      assertActorId(lease.actorId);
      try {
        await client.connect();
        await runScript(deletePresenceLeaseScript, 3, [
          redisKey(namespace, 'presence', 'conn', lease.connId),
          redisKey(namespace, 'presence', 'actor', lease.actorId),
          redisKey(namespace, 'presence', 'online'),
          lease.connId,
          lease.actorId,
        ]);
      } catch (error) {
        reportFailure('deletePresenceLease');
        throw error;
      }
    },
    /**
     * An actor's live connections, trimmed, hydrated and actorId-checked in
     * one Lua op. `nowMs` is the Redis server clock the script used to trim
     * and score these leases (ADR 0033 §1.1); a caller computing
     * `derivePresence`'s `nowMs` must use this, never an instance clock.
     */
    async readActorConnections(actorId: string): Promise<{
      readonly connections: readonly PresenceConnection[];
      readonly nowMs: number;
    }> {
      assertActorId(actorId);
      try {
        await client.connect();
        const flat = (await runScript(readActorConnectionsScript, 1, [
          redisKey(namespace, 'presence', 'actor', actorId),
          actorId,
          `${redisKey(namespace, 'presence', 'conn')}:`,
        ])) as (string | number)[];
        const nowMs = Number(flat[0]);
        const connections: PresenceConnection[] = [];
        for (let index = 1; index < flat.length; index += 5) {
          connections.push({
            connId: flat[index] as string,
            actorId: flat[index + 1] as string,
            activity: parseActivity(String(flat[index + 2])),
            instanceId: flat[index + 3] as string,
            expiresAtMs: Number(flat[index + 4]),
          });
        }
        return { connections, nowMs };
      } catch (error) {
        reportFailure('readActorConnections');
        throw error;
      }
    },
    /**
     * A bounded, read-only range of the online set (live actors only; no
     * write-on-read — see `sweepOnlinePresence`). `nowMs` is the Redis
     * server clock the script used to filter these actors (ADR 0033 §1.1);
     * a caller computing `derivePresence`'s `nowMs` must use this, never an
     * instance clock.
     */
    async readOnlinePresence(limit: number): Promise<{
      readonly actors: readonly PresenceOnlineActor[];
      readonly nowMs: number;
    }> {
      assertLimit(limit);
      try {
        await client.connect();
        const flat = (await runScript(readOnlinePresenceScript, 1, [
          redisKey(namespace, 'presence', 'online'),
          String(limit),
        ])) as (string | number)[];
        const nowMs = Number(flat[0]);
        const actors: PresenceOnlineActor[] = [];
        for (let index = 1; index < flat.length; index += 2) {
          actors.push({
            actorId: flat[index] as string,
            expiresAtMs: Number(flat[index + 1]),
          });
        }
        return { actors, nowMs };
      } catch (error) {
        reportFailure('readOnlinePresence');
        throw error;
      }
    },
    /**
     * Removes up to `limit` expired members from the online set. The write
     * side of trimming that `readOnlinePresence` no longer does; callers
     * run this on a bounded schedule (a periodic sweep), not per read.
     * Returns the number of members removed.
     */
    async sweepOnlinePresence(limit: number): Promise<number> {
      assertLimit(limit);
      try {
        await client.connect();
        return (await runScript(sweepOnlinePresenceScript, 1, [
          redisKey(namespace, 'presence', 'online'),
          String(limit),
        ])) as number;
      } catch (error) {
        reportFailure('sweepOnlinePresence');
        throw error;
      }
    },
  };
}
