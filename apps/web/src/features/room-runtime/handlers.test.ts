import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { createRoomHandlers } from './handlers';
import type { RoomRuntimeOperations } from './operations';
import { silentLogger } from '../../server/test-loggers.test-support';
setupRitewayBun();
const origin = 'http://localhost:3000';
const id = 'abcdefghijklmnopqrstuvwx';
const member: Identity = {
  state: 'member',
  username: 'Member',
  principal: { kind: 'user', userId: id, actorId: id },
};
/** Handler dependencies that admit `identity` and run `operations`. */
const dependencies = (
  identity: Identity,
  operations: Partial<Record<keyof RoomRuntimeOperations, unknown>>,
) => ({
  logger: silentLogger,
  origin: () => origin,
  identify: async () => identity,
  getActorByUserId: async () => ({ id }),
  operations: operations as unknown as RoomRuntimeOperations,
  active: () => true,
  maxBodyBytes: 4096,
  limiter: () => ({
    consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  }),
  limits: {
    create: { max: 10, windowSeconds: 60 },
    read: { max: 10, windowSeconds: 60 },
    command: { max: 10, windowSeconds: 60 },
  },
});
test('canonical Room handler refuses origin, identity and claimed principal before operations', async () => {
  let calls = 0;
  const run = async (
    identity: Identity,
    suppliedOrigin: string,
    body: unknown,
  ) => {
    const handlers = createRoomHandlers(
      dependencies(identity, {
        command: async () => {
          calls++;
          return {} as never;
        },
      }),
    );
    return (
      await handlers.commands(
        new Request(`${origin}/api/rooms/${id}/commands`, {
          method: 'POST',
          headers: {
            origin: suppliedOrigin,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
        id,
      )
    ).status;
  };
  const body = {
    commandId: id,
    expectedVersion: 1,
    expectedConsentVersion: 0,
    type: 'ready',
  };
  const statuses = [
    await run(member, 'https://foreign.invalid', body),
    await run(
      { state: 'anonymous', principal: { kind: 'anonymous' } },
      origin,
      body,
    ),
    await run(member, origin, { ...body, actorId: id }),
  ];
  assert({
    given: 'foreign Origin, anonymous session and acting actor claim',
    should: 'refuse each at the canonical boundary without mutation',
    actual: [statuses, calls],
    expected: [[403, 401, 400], 0],
  });
});

test('room and round reads name the realtime endpoint their doorbells ring on', async () => {
  const handlers = (websocketEndpoint: string | null) =>
    createRoomHandlers({
      ...dependencies(member, {
        view: async () => ({ id }),
        roundView: async () => ({ id }),
        catalog: async () => [],
        castChoices: async () => [],
      }),
      websocketEndpoint,
    });
  const read = (path: string) =>
    new Request(`${origin}${path}`, { headers: { origin } });
  const endpoint = 'wss://socket.daisy.invalid/realtime';
  const configured = handlers(endpoint);
  const unconfigured = handlers(null);
  const header = (response: Response) =>
    response.headers.get('x-realtime-socket-url');
  assert({
    given:
      'room, round and catalog reads with realtime configured, and a room read without it',
    should: 'name the endpoint on the room and round reads only',
    actual: [
      header(await configured.read(read(`/api/rooms/${id}`), id)),
      header(await configured.roundRead(read(`/api/rounds/${id}`), id)),
      header(await configured.catalog(read('/api/rooms/catalog'))),
      header(await unconfigured.read(read(`/api/rooms/${id}`), id)),
    ],
    expected: [endpoint, endpoint, null, null],
  });
});

test('an already-in-a-room refusal carries the caller’s own active Room (ADR 0070)', async () => {
  const activeRoom = {
    version: 1,
    id: 'm'.repeat(24),
    title: 'Current room',
    phase: 'assembling',
    role: 'host',
    href: `/rooms/${'m'.repeat(24)}`,
  };
  const { createAppError } = await import('@daisy/errors');
  const handlers = createRoomHandlers(
    dependencies(member, {
      create: async () => {
        throw createAppError('CONFLICT', 'active-room');
      },
      activeRoom: async () => activeRoom,
    }),
  );
  const created = await handlers.create(
    new Request(`${origin}/api/rooms`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        commandId: id,
        title: 'Room',
        topic: 'Motion',
        visibility: 'public',
        selection: {
          kind: 'ranked',
          formatId: 'foundation',
          formatVersion: 1,
          presetVersion: 1,
        },
      }),
    }),
  );
  const read = await handlers.active(
    new Request(`${origin}/api/rooms/active`, { headers: { origin } }),
  );
  const body = await created.json();
  assert({
    given:
      'a create refused because another Room holds the caller, then a read',
    should:
      'answer 409 active-room with that Room, and read the same Room on its own route',
    actual: [
      created.status,
      body.refusal,
      body.activeRoom,
      body.error.code,
      await read.json(),
    ],
    expected: [409, 'active-room', activeRoom, 'CONFLICT', { activeRoom }],
  });
});
