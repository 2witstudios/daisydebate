import { createId } from '@paralleldrive/cuid2';
import {
  buildRoomTopic,
  roomCatalogChoiceSchema,
  roomViewSchema,
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
} from '@daisy/protocol';
import { test, expect, openPage } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { settledLaunchAuth } from './support/room-launch-settled';
import { requireLaunchSlot } from './support/room-launch-slot';
import { resolve } from 'node:path';
import { origin } from './support/accounts';
import {
  browserTransportSource,
  connectRoomTransport,
} from './support/realtime-fixture';
import { resolveE2EPorts } from '../playwright.config';

requireLaunchSlot(resolve(import.meta.dirname, '../../..'), process.env);

test('real HTTP Room mutation reaches its authenticated browser subscriber and refuses a private outsider', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const host = accounts.members[0]!.context;
    const outsider = accounts.members[1]!.context;
    const catalogResponse = await host.request.get('/api/rooms/catalog');
    expect(catalogResponse.status()).toBe(200);
    const choices = (await catalogResponse.json()).choices.map(
      (value: unknown) => roomCatalogChoiceSchema.parse(value),
    );
    const choice = choices.find(
      (value: { formatId: string }) => value.formatId === 'foundation',
    );
    if (!choice) throw new Error('Canonical Room format producer unavailable');
    const created = await host.request.post('/api/rooms', {
      headers: { origin },
      data: {
        commandId: createId(),
        title: 'Realtime isolated proof',
        topic: 'Cities should fund public transit',
        visibility: 'private',
        selection: {
          kind: 'template',
          formatId: choice.formatId,
          formatVersion: choice.formatVersion,
          length: 'full',
          competitionType: 'casual',
          config: choice.defaultConfig,
        },
      },
    });
    expect(created.status()).toBe(200);
    const before = roomViewSchema.parse((await created.json()).view);
    const topic = buildRoomTopic(before.id);
    const hostPage = await openPage(host, 'RT authorized host'),
      outsiderPage = await openPage(outsider, 'RT private outsider');
    await hostPage.goto('/lobby');
    await outsiderPage.goto('/lobby');
    const source = browserTransportSource();
    await connectRoomTransport(hostPage, topic, source);
    await connectRoomTransport(outsiderPage, topic, source);
    await expect
      .poll(() =>
        hostPage.evaluate(() =>
          window.realtimeProof.frames.some(
            (frame) => frame.type === 'subscribed',
          ),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        outsiderPage.evaluate(() =>
          window.realtimeProof.frames.some(
            (frame) => frame.type === 'error' && frame.code === 'AUTHORIZATION',
          ),
        ),
      )
      .toBe(true);
    const mutation = await host.request.post(
      `/api/rooms/${before.id}/commands`,
      {
        headers: { origin },
        data: {
          type: 'update-details',
          commandId: createId(),
          expectedVersion: before.version,
          title: 'Changed only through HTTP',
          topic: before.topic,
          visibility: 'private',
        },
      },
    );
    expect(mutation.status()).toBe(200);
    const changed = roomViewSchema.parse((await mutation.json()).view);
    await expect
      .poll(() =>
        hostPage.evaluate(
          (version) =>
            window.realtimeProof.frames.filter(
              (frame) =>
                frame.type === 'event' &&
                frame.payload.kind === 'room.changed' &&
                frame.payload.entityVersion === version,
            ).length,
          changed.changeVersion,
        ),
      )
      .toBe(1);
    const bell = await hostPage.evaluate(
      (version) =>
        window.realtimeProof.frames.find(
          (frame) =>
            frame.type === 'event' &&
            frame.payload.kind === 'room.changed' &&
            frame.payload.entityVersion === version,
        ),
      changed.changeVersion,
    );
    expect(bell?.type).toBe('event');
    if (bell?.type !== 'event')
      throw new Error('Validated Room bell unavailable');
    expect(bell.topic).toBe(topic);
    expect(bell.payload).toEqual({
      kind: 'room.changed',
      ids: [before.id],
      entityVersion: changed.changeVersion,
    });
    const authoritative = await host.request.get(`/api/rooms/${before.id}`);
    expect(roomViewSchema.parse(await authoritative.json()).title).toBe(
      'Changed only through HTTP',
    );
    expect(
      await outsiderPage.evaluate(() =>
        window.realtimeProof.frames.some(
          (frame) => frame.type === 'event' || frame.type === 'subscribed',
        ),
      ),
    ).toBe(false);
    const revoked = await host.request.post('/api/auth/revoke-sessions', {
      headers: { origin },
      data: {},
    });
    expect(revoked.status()).toBe(200);
    await expect
      .poll(() =>
        hostPage.evaluate(() => window.realtimeProof.store.getState().terminal),
      )
      .toBe('revoked');
    await outsiderPage.evaluate(() => window.realtimeProof.store.close());
  } finally {
    await settledLaunchAuth();
    await accounts.closeContexts();
  }
});

test('a real issued ticket accepts one hello and refuses its second consumption', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const page = await openPage(
      accounts.members[0]!.context,
      'RT ticket consumer',
    );
    await page.goto('/lobby');
    const result = await page.evaluate(
      async ({ v, protocolVersion, endpoint }) => {
        const response = await fetch('/api/realtime/ticket', {
          method: 'POST',
          credentials: 'same-origin',
        });
        const body = await response.json();
        if (
          response.status !== 200 ||
          body.socketUrl !== endpoint ||
          typeof body.ticket !== 'string'
        )
          throw new Error('Actual ticket endpoint unavailable');
        const open = () =>
          new Promise<'ready' | number>((accept, reject) => {
            const socket = new WebSocket(body.socketUrl);
            socket.onopen = () =>
              socket.send(
                JSON.stringify({
                  v,
                  type: 'hello',
                  protocolVersion,
                  ticket: body.ticket,
                }),
              );
            socket.onmessage = (event) => {
              if (JSON.parse(String(event.data)).type === 'ready') {
                accept('ready');
                socket.close();
              }
            };
            socket.onclose = (event) => accept(event.code);
            socket.onerror = () =>
              reject(new Error('Native ticket socket failed'));
          });
        return [await open(), await open()];
      },
      {
        v: ENVELOPE_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        endpoint: `wss://localhost:${resolveE2EPorts(process.env).realtime}/ws`,
      },
    );
    expect(result).toEqual(['ready', 4001]);
  } finally {
    await settledLaunchAuth();
    await accounts.closeContexts();
  }
});
