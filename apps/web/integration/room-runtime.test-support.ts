import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { systemId } from '@daisy/clock';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { createRedis, redisKey } from '@daisy/redis';
import { createBoundedTestClient, testNamespace } from '@daisy/redis/testing';
import { deleteNamespace } from '@daisy/redis/namespaces';
import type { RoomCommand, RoomCreate, RoomView } from '@daisy/protocol';
import { createRoomRuntimeOperations } from '../src/features/room-runtime/operations';
const services = requireTestServices(process.env);
export async function withRoomRuntime(
  run: (context: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
) {
  const f = await fixture();
  try {
    await run(f);
  } finally {
    await f.close();
  }
}
async function fixture() {
  const sql = new SQL(services.databaseUrl),
    client = createBoundedTestClient(services.redisUrl),
    namespace = testNamespace(createId());
  const redis = createRedis({ url: services.redisUrl, namespace, client });
  const store = createDatabase({
    url: services.databaseUrl,
    nextActorId: createId,
  });
  const callers: { userId: string; actorId: string }[] = [],
    rooms: string[] = [];
  const caller = async () => {
    const userId = createId(),
      actorId = createId();
    await sql`insert into users (id,username,email_verified) values (${userId},${`u-${userId}`},true)`;
    await sql`insert into actors (id,kind,user_id) values (${actorId},'human',${userId})`;
    const c = { userId, actorId };
    callers.push(c);
    return c;
  };
  const host = await caller(),
    guest = await caller(),
    outsider = await caller();
  let openRoomLimit = 5;
  let failAfterReady = false;
  let unavailable = false;
  let consentReads = 0;
  let gate: (() => Promise<void>) | null = null;
  const controlled = {
    ...redis,
    setRoomConsent: async (
      ...args: Parameters<typeof redis.setRoomConsent>
    ) => {
      await redis.setRoomConsent(...args);
      if (failAfterReady) throw new Error('fixture crash after consent write');
    },
    readRoomConsent: async (
      ...args: Parameters<typeof redis.readRoomConsent>
    ) => {
      consentReads += 1;
      if (unavailable) throw new Error('fixture Redis unavailable');
      if (gate) await gate();
      return redis.readRoomConsent(...args);
    },
  };
  const operations = createRoomRuntimeOperations({
    store,
    redis: controlled,
    ids: systemId,
    maxOpenRooms: () => openRoomLimit,
    consentTtlMs: () => 60_000,
    botsAvailable: () => true,
  });
  const create = async (overrides: Partial<RoomCreate> = {}) => {
    const config = (await operations.catalog(host)).find(
      (c) => c.formatId === 'foundation',
    )!.defaultConfig;
    const r = await operations.create(host, {
      commandId: createId(),
      title: 'Durable room',
      topic: 'Cities should make transit free',
      visibility: 'public',
      selection: {
        kind: 'catalog',
        formatId: 'foundation',
        formatVersion: 1,
        length: 'full',
        competitionType: 'casual',
        config,
      },
      ...overrides,
    });
    rooms.push(r.view.id);
    return r;
  };
  const command = (
    who: typeof host,
    view: RoomView,
    body: unknown,
    commandId = createId(),
  ) =>
    operations.command(who, view.id, {
      ...(body as object),
      commandId,
      expectedVersion: view.version,
    } as RoomCommand);
  const snapshot = async (id: string) => {
    const [r] =
      await sql`select (select row_to_json(r) from rooms r where id=${id}) room,
      (select coalesce(json_agg(p order by id),'[]'::json) from room_participants p where room_id=${id}) seats,
      (select coalesce(json_agg(c order by command_id),'[]'::json) from room_commands c where room_id=${id}) commands,
      (select coalesce(json_agg(r order by id),'[]'::json) from rounds r where room_id=${id}) rounds,
      (select coalesce(json_agg(o order by seq),'[]'::json) from outbox o where topic=${`room:${id}`}) outbox`;
    return JSON.stringify(r);
  };
  const assemble = async (overrides: Partial<RoomCreate> = {}) => {
    let view = (await create(overrides)).view;
    view = (
      await command(host, view, {
        type: 'claim-seat',
        role: 'affirmative',
        slot: 0,
      })
    ).view;
    view = (
      await command(guest, view, {
        type: 'claim-seat',
        role: 'negative',
        slot: 0,
      })
    ).view;
    for (const c of [host, guest])
      view = (
        await command(c, view, {
          type: 'ready',
          expectedConsentVersion: view.participants.find(
            (p) => p.actorId === c.actorId,
          )!.consentVersion,
        })
      ).view;
    return operations.view(host, view.id);
  };
  return {
    sql,
    store,
    redis,
    operations,
    host,
    guest,
    outsider,
    create,
    command,
    consent: (caller: typeof host, view: RoomView, type: 'ready' | 'unready') =>
      command(caller, view, {
        type,
        expectedConsentVersion: view.participants.find(
          (p) => p.actorId === caller.actorId,
        )!.consentVersion,
      }),
    snapshot,
    assemble,
    openRoomLimit: (value: number) => {
      openRoomLimit = value;
    },
    failAfterReady: (value: boolean) => {
      failAfterReady = value;
    },
    unavailable: (value: boolean) => {
      unavailable = value;
    },
    consentReads: () => consentReads,
    gateConsent: (next: typeof gate) => {
      gate = next;
    },
    expire: async (view: RoomView, actorId: string) => {
      const [fence] = await sql<
        { readiness_command_id: string }[]
      >`select readiness_command_id from room_participants where room_id=${view.id} and actor_id=${actorId}`;
      if (!fence?.readiness_command_id)
        throw new Error('Expiry proof requires committed consent');
      return client.send('PEXPIREAT', [
        redisKey(
          namespace,
          'room-ready',
          view.id,
          String(view.version),
          actorId,
          fence.readiness_command_id,
        ),
        '1',
      ]);
    },
    close: async () => {
      await store.close();
      await deleteNamespace(client, namespace);
      redis.close();
      try {
        for (const id of rooms) {
          await sql`delete from outbox where topic=${`room:${id}`}`;
          await sql`delete from ballots where judge_participant_id in (select id from round_participants where round_id in (select id from rounds where room_id=${id}))`;
          await sql`delete from utterances where round_id in (select id from rounds where room_id=${id})`;
          await sql`delete from agent_runs where round_participant_id in (select id from round_participants where round_id in (select id from rounds where room_id=${id}))`;
          await sql`delete from outbox where topic in (select 'debate:' || id from rounds where room_id=${id})`;
          await sql`delete from rounds where room_id=${id}`;
          await sql`delete from rooms where id=${id}`;
        }
        for (const c of callers) {
          const formats =
            await sql`select id from formats where created_by_actor_id=${c.actorId}`;
          for (const f of formats) {
            await sql`delete from formats where id=${f.id}`;
            await sql`delete from format_revisions where format_id=${f.id}`;
          }
          await sql`delete from actors where id=${c.actorId}`;
          await sql`delete from users where id=${c.userId}`;
        }
      } finally {
        await sql.close();
      }
    },
  };
}

export function consentBarrier(f: {
  gateConsent: (gate: (() => Promise<void>) | null) => void;
}) {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
      enter = resolve;
    }),
    released = new Promise<void>((resolve) => {
      release = resolve;
    });
  f.gateConsent(async () => {
    f.gateConsent(null);
    enter();
    await released;
  });
  return { entered, release: () => release() };
}
