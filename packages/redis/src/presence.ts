import type { RedisTransport } from './transport';
import type { PresenceActivity } from '@daisy/protocol';
import { redisKey } from './redis-key';
import {
  ACTOR_CONNECTIONS_MAX,
  assertActorId,
  assertKeySegment,
  assertLimit,
  assertTtlSeconds,
  countOnlinePresenceScript,
  createScriptRunner,
  deletePresenceLeaseScript,
  PRESENCE_ACTORS_MAX,
  PRESENCE_LIMIT_MAX,
  readActorsPresenceScript,
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
  readonly client: RedisTransport;
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
        await runScript(upsertPresenceLeaseScript, 4, [
          redisKey(namespace, 'presence', 'conn', lease.connId),
          redisKey(namespace, 'presence', 'actor', lease.actorId),
          redisKey(namespace, 'presence', 'online'),
          redisKey(namespace, 'presence', 'roster-revision'),
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
        await runScript(deletePresenceLeaseScript, 4, [
          redisKey(namespace, 'presence', 'conn', lease.connId),
          redisKey(namespace, 'presence', 'actor', lease.actorId),
          redisKey(namespace, 'presence', 'online'),
          redisKey(namespace, 'presence', 'roster-revision'),
          lease.connId,
          lease.actorId,
        ]);
      } catch (error) {
        reportFailure('deletePresenceLease');
        throw error;
      }
    },
    /**
     * An actor's live connections (at most `ACTOR_CONNECTIONS_MAX`, latest
     * expiry first), hydrated and actorId-checked in one read-only Lua op. `nowMs` is the Redis server clock the script used to trim
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
          String(ACTOR_CONNECTIONS_MAX),
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
    async readOnlinePresence(
      limit: number,
      offset = 0,
    ): Promise<{
      readonly actors: readonly PresenceOnlineActor[];
      readonly nowMs: number;
    }> {
      assertLimit(limit);
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new Error('Presence offset must be a non-negative integer');
      try {
        await client.connect();
        const flat = (await runScript(readOnlinePresenceScript, 1, [
          redisKey(namespace, 'presence', 'online'),
          String(limit),
          String(offset),
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
     * Each actor's activity across their live connections (`null` when
     * none is live), for at most `PRESENCE_ACTORS_MAX` actors in one
     * read-only op. The caller decides who may see it: presence grants
     * nothing (ADR 0072).
     */
    async readActorsPresence(
      actorIds: readonly string[],
    ): Promise<ReadonlyMap<string, PresenceActivity | null>> {
      if (actorIds.length > PRESENCE_ACTORS_MAX)
        throw new Error(
          `At most ${PRESENCE_ACTORS_MAX} actors per presence read`,
        );
      for (const actorId of actorIds) assertActorId(actorId);
      if (actorIds.length === 0) return new Map();
      try {
        await client.connect();
        const flat = (await runScript(
          readActorsPresenceScript,
          actorIds.length,
          [
            ...actorIds.map((actorId) =>
              redisKey(namespace, 'presence', 'actor', actorId),
            ),
            `${redisKey(namespace, 'presence', 'conn')}:`,
            String(ACTOR_CONNECTIONS_MAX),
            ...actorIds,
          ],
        )) as (string | number)[];
        return new Map(
          actorIds.map((actorId, index) => {
            const value = String(flat[index + 1] ?? '');
            return [actorId, value === '' ? null : parseActivity(value)];
          }),
        );
      } catch (error) {
        reportFailure('readActorsPresence');
        throw error;
      }
    },
    /**
     * Every online actor id, scanned a page at a time up to `max` (ADR 0098).
     * A member who moves between pages mid-scan appears at most once, and the
     * next ring reads them again.
     */
    async readOnlineActorIds(max: number): Promise<readonly string[]> {
      const ids = new Set<string>();
      for (let offset = 0; offset < max; offset += PRESENCE_LIMIT_MAX) {
        const { actors } = await this.readOnlinePresence(
          Math.min(PRESENCE_LIMIT_MAX, max - offset),
          offset,
        );
        for (const actor of actors) ids.add(actor.actorId);
        if (actors.length < PRESENCE_LIMIT_MAX) break;
      }
      return [...ids];
    },
    /**
     * The roster revision (ADR 0098): it moves when a lease appears, changes
     * activity or goes. Zero when none has yet. Names nobody.
     */
    async readRosterRevision(): Promise<number> {
      try {
        await client.connect();
        const value = await client.get(
          redisKey(namespace, 'presence', 'roster-revision'),
        );
        return value === null ? 0 : Number(value);
      } catch (error) {
        reportFailure('readRosterRevision');
        throw error;
      }
    },
    /** How many actors hold a live lease now, by the Redis clock. */
    async countOnlinePresence(): Promise<number> {
      try {
        await client.connect();
        return Number(
          await runScript(countOnlinePresenceScript, 1, [
            redisKey(namespace, 'presence', 'online'),
          ]),
        );
      } catch (error) {
        reportFailure('countOnlinePresence');
        throw error;
      }
    },
    /**
     * Removes up to `limit` (at most `PRESENCE_LIMIT_MAX`) expired members
     * from the online set. The write side of trimming that
     * `readOnlinePresence` never does; the web retention sweep runs it on
     * its schedule, not per read (ADR 0033). Returns the number removed.
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
