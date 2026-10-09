import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import {
  roomViewSchema,
  roomCatalogChoiceSchema,
  roundViewSchema,
  type RoomView,
} from '@daisy/protocol';
import { createRoutes } from '../src/server/routes';
import { inProcessFetch } from '../src/server/in-process-fetch';
import { createAccountFlows, uniqueName } from './auth-account-helpers';
import { createTestApp, withSql } from './fixtures';
requireTestServices(process.env);
setupRitewayBun();
const f = createTestApp();
const account = createAccountFlows(f);
// Explicit proof policy. No production process or deploy default is activated.
const routes = createRoutes({
  ...f.app,
  roomPolicy: {
    consentTtlMs: 60_000,
    maxOpenRooms: 5,
    maxBodyBytes: 262_144,
    limits: {
      create: { max: 20, windowSeconds: 60 },
      read: { max: 200, windowSeconds: 60 },
      command: { max: 200, windowSeconds: 60 },
    },
  },
});
const headers = (cookie: string) =>
  new Headers({ cookie, origin: f.origin, 'content-type': 'application/json' });
const member = async () => {
  const signed = await account.signUp();
  const response = await account.claim(signed.cookie, {
    username: uniqueName(),
  });
  if (response.status !== 201)
    throw new Error('Fixture membership claim failed');
  return signed.cookie;
};
const command = async (cookie: string, view: RoomView, body: object) => {
  const response = await inProcessFetch(
    (request) => routes.rooms.commands(request, view.id),
    headers(cookie),
  )(`/api/rooms/${view.id}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...body,
      commandId: createId(),
      expectedVersion: view.version,
    }),
  });
  if (response.status !== 200)
    throw new Error(
      `Fixture accepted Room command returned ${response.status}`,
    );
  return roomViewSchema.parse((await response.json()).view);
};
test('real authenticated HTTP and native-form transport share principal, origin, version and Launch authority', async () => {
  const host = await member(),
    guest = await member(),
    outsider = await member();
  let roomId: string | null = null;
  try {
    const catalogResponse = await routes.rooms.catalog(
      new Request(`${f.origin}/api/rooms/catalog`, { headers: headers(host) }),
    );
    const catalog = (await catalogResponse.json()).choices.map(
      (choice: unknown) => roomCatalogChoiceSchema.parse(choice),
    );
    const choice = catalog.find(
      (c: { formatId: string }) => c.formatId === 'foundation',
    )!;
    const created = await routes.rooms.create(
      f.jsonPost(
        '/api/rooms',
        {
          commandId: createId(),
          title: 'Authenticated Launch',
          topic: 'Cities should fund transit',
          visibility: 'private',
          selection: {
            kind: 'catalog',
            formatId: choice.formatId,
            formatVersion: choice.formatVersion,
            length: 'full',
            competitionType: 'casual',
            config: choice.defaultConfig,
          },
        },
        { cookie: host },
      ),
    );
    let view = roomViewSchema.parse((await created.json()).view);
    roomId = view.id;
    const anonymous = await routes.rooms.read(
      new Request(`${f.origin}/api/rooms/${roomId}`),
      roomId,
    );
    const denied = await routes.rooms.read(
      new Request(`${f.origin}/api/rooms/${roomId}`, {
        headers: headers(outsider),
      }),
      roomId,
    );
    const badOrigin = await inProcessFetch(
      (request) => routes.rooms.commands(request, view.id),
      new Headers({ cookie: host, origin: 'https://foreign.invalid' }),
    )(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'close',
        commandId: createId(),
        expectedVersion: view.version,
      }),
    });
    const notHost = await routes.rooms.commands(
      f.jsonPost(
        `/api/rooms/${roomId}/commands`,
        { type: 'close', commandId: createId(), expectedVersion: view.version },
        { cookie: outsider },
      ),
      roomId,
    );
    assert({
      given:
        'anonymous, foreign origin and private outsider requests through canonical routes',
      should:
        'refuse and mask the private resource even for native-form transport',
      actual: [
        created.status,
        anonymous.status,
        denied.status,
        badOrigin.status,
        notHost.status,
      ],
      expected: [201, 401, 404, 403, 404],
    });
    view = await command(host, view, {
      type: 'update-details',
      title: view.title,
      topic: view.topic,
      visibility: 'public',
    });
    view = await command(host, view, {
      type: 'claim-seat',
      role: 'affirmative',
      slot: 0,
    });
    view = await command(guest, view, {
      type: 'claim-seat',
      role: 'negative',
      slot: 0,
    });
    const hostActor = view.hostActorId,
      guestActor = view.participants.find(
        (p) => p.actorId !== hostActor,
      )!.actorId;
    view = await command(host, view, {
      type: 'ready',
      expectedConsentVersion: view.participants.find(
        (p) => p.actorId === hostActor,
      )!.consentVersion,
    });
    view = await command(guest, view, {
      type: 'ready',
      expectedConsentVersion: view.participants.find(
        (p) => p.actorId === guestActor,
      )!.consentVersion,
    });
    const before = await routes.rooms.read(
      new Request(`${f.origin}/api/rooms/${roomId}`, {
        headers: headers(host),
      }),
      roomId,
    );
    view = roomViewSchema.parse(await before.json());
    const launch = {
      commandId: createId(),
      expectedVersion: view.version,
      type: 'start-round',
    };
    const post = () =>
      routes.rooms.commands(
        f.jsonPost(`/api/rooms/${roomId}/commands`, launch, { cookie: host }),
        roomId!,
      );
    const [first, retry] = await Promise.all([post(), post()]);
    const firstBody = await first.json(),
      retryBody = await retry.json();
    const launched = roomViewSchema.parse(firstBody.view);
    const roundResponse = await routes.rounds.read(
      new Request(`${f.origin}/api/rounds/${launched.roundRef!.id}`, {
        headers: headers(guest),
      }),
      launched.roundRef!.id,
    );
    const round = roundViewSchema.parse(await roundResponse.json());
    assert({
      given:
        'two actual member cookies, version-bound Ready and concurrent Launch/retry',
      should:
        'acknowledge one scheduled persisted Round through the same authenticated read boundary',
      actual: [
        first.status,
        retry.status,
        firstBody.receipt.replayed !== retryBody.receipt.replayed,
        roundResponse.status,
        round.status,
        round.startedAt,
        round.topic,
        round.config,
        round.participants.map((p) => p.actorId).sort(),
      ],
      expected: [
        200,
        200,
        true,
        200,
        'scheduled',
        null,
        view.topic,
        view.config,
        [hostActor, guestActor].sort(),
      ],
    });
  } finally {
    if (roomId)
      await withSql(async (sql) => {
        await sql`delete from round_participants where round_id in (select id from rounds where room_id=${roomId})`;
        await sql`delete from rounds where room_id=${roomId}`;
        await sql`delete from room_commands where room_id=${roomId}`;
        await sql`delete from room_participants where room_id=${roomId}`;
        await sql`delete from outbox where topic=${`room:${roomId}`}`;
        await sql`delete from rooms where id=${roomId}`;
      });
  }
});
