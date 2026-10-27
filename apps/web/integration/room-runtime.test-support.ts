import { SQL } from 'bun';
import { admitParticipants } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { systemId } from '@daisy/clock';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { createRedis, redisKey } from '@daisy/redis';
import { createBoundedTestClient, testNamespace } from '@daisy/redis/testing';
import { deleteNamespace } from '@daisy/redis/namespaces';
import {
  isNamedSeat,
  type RoomCommand,
  type RoomCreate,
  type RoomView,
} from '@daisy/protocol';
import { createRoomRuntimeOperations } from '../src/features/room-runtime/operations';
import { foundationSelection } from './foundation-selection.test-support';

import { drawEntropy } from '../src/features/room-runtime/entropy';
const services = requireTestServices(process.env);
export async function withRoomRuntime(
  run: (context: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
  options: Pick<
    Parameters<typeof createDatabase>[0],
    | 'client'
    | 'maxConnections'
    | 'botAdmission'
    | 'judging'
    | 'botPublication'
    | 'roundAnalysis'
  > = {},
) {
  const f = await fixture(options);
  try {
    await run(f);
  } finally {
    await f.close();
  }
}
async function fixture(
  options: Pick<
    Parameters<typeof createDatabase>[0],
    | 'client'
    | 'maxConnections'
    | 'botAdmission'
    | 'judging'
    | 'botPublication'
    | 'roundAnalysis'
  >,
) {
  const sql = new SQL(services.databaseUrl),
    client = createBoundedTestClient(services.redisUrl),
    namespace = testNamespace(createId());
  const redis = createRedis({ url: services.redisUrl, namespace, client });
  const store = createDatabase({
    url: services.databaseUrl,
    nextActorId: createId,
    ...options,
  });
  const callers: { userId: string; actorId: string }[] = [],
    rooms: string[] = [],
    bots: string[] = [];
  const bot = async () => {
    const actorId = createId();
    await sql`insert into actors(id,kind) values (${actorId},'bot')`;
    bots.push(actorId);
    await sql`insert into bot_profiles(actor_id,name,persona,voice) values (${actorId},'Fixture judge','Assess only recorded evidence','test')`;
    return { actorId };
  };
  const caller = async () => {
    const userId = createId(),
      actorId = createId();
    await sql`insert into users (id,username,email_verified) values (${userId},${`u-${userId}`},true)`;
    await sql`insert into actors (id,kind,user_id) values (${actorId},'human',${userId})`;
    // Room callers are admitted participants (ADR 0075); removing the user cascades.
    await admitParticipants(sql, [userId]);
    const c = { userId, actorId };
    callers.push(c);
    return c;
  };
  const host = await caller(),
    guest = await caller(),
    outsider = await caller();
  let failAfterReady = false;
  let unavailable = false;
  let consentReads = 0;
  let gate: (() => Promise<void>) | null = null;
  let readyGate: (() => Promise<void>) | null = null;
  const controlled = {
    ...redis,
    setRoomConsent: async (
      ...args: Parameters<typeof redis.setRoomConsent>
    ) => {
      if (readyGate) await readyGate();
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
    entropy: drawEntropy,
    consentTtlMs: () => 60_000,
    botsAvailable: () => true,
  });
  /** The proof format every Room suite builds on; off the picker (FMT-1), so custom. */
  const foundation = async () => ({
    definition: foundationSelection.definition,
    preset: { config: foundationSelection.config },
  });
  const create = async (
    overrides: Partial<RoomCreate> = {},
    who: typeof host = host,
  ) => {
    const r = await operations.create(who, {
      commandId: createId(),
      title: 'Durable room',
      topic: 'Cities should make transit free',
      visibility: 'public',
      selection: foundationSelection,
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
  const consent = (
    who: typeof host,
    view: RoomView,
    type: 'ready' | 'unready',
  ) =>
    command(who, view, {
      type,
      expectedConsentVersion: view.participants
        .filter(isNamedSeat)
        .find((p) => p.actorId === who.actorId)!.consentVersion,
    });
  const seatBotOpponent = async (view: RoomView, actorId: string) => {
    view = (
      await command(host, view, {
        type: 'claim-seat',
        role: 'affirmative',
        slot: 0,
      })
    ).view;
    view = (
      await command(host, view, {
        type: 'assign-seat',
        actorId,
        role: 'negative',
        slot: 0,
      })
    ).view;
    return (await consent(host, await operations.view(host, view.id), 'ready'))
      .view;
  };
  /** A new host and guest: one user holds one active Room (ADR 0070). */
  const freshCast = async () => ({
    host: await caller(),
    guest: await caller(),
  });
  const callerOf = (actorId: string) => {
    const found = callers.find((c) => c.actorId === actorId);
    if (!found) throw new Error('No fixture caller holds that actor');
    return found;
  };
  const assemble = async (
    overrides: Partial<RoomCreate> = {},
    cast: { readonly host: typeof host; readonly guest: typeof host } = {
      host,
      guest,
    },
  ) => {
    let view = (await create(overrides, cast.host)).view;
    view = (
      await command(cast.host, view, {
        type: 'claim-seat',
        role: 'affirmative',
        slot: 0,
      })
    ).view;
    view = (
      await command(cast.guest, view, {
        type: 'claim-seat',
        role: 'negative',
        slot: 0,
      })
    ).view;
    for (const c of [cast.host, cast.guest])
      view = (await consent(c, view, 'ready')).view;
    return operations.view(cast.host, view.id);
  };
  return {
    sql,
    store,
    redis,
    operations,
    host,
    guest,
    outsider,
    /** Another member, cleaned up with the rest. */
    member: caller,
    bot,
    create,
    foundation,
    foundationSelection,
    command,
    consent,
    seatBotOpponent,
    snapshot,
    assemble,
    freshCast,
    callerOf,
    failAfterReady: (value: boolean) => {
      failAfterReady = value;
    },
    unavailable: (value: boolean) => {
      unavailable = value;
    },
    consentReads: () => consentReads,
    gateReady: (next: typeof readyGate) => {
      readyGate = next;
    },
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
          await sql`delete from outbox where topic in (select 'debate:' || id from rounds where room_id=${id})`;
          await sql`delete from rounds where room_id=${id}`;
          await sql`delete from rooms where id=${id}`;
        }
        for (const actorId of bots)
          await sql`delete from actors where id=${actorId}`;
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
