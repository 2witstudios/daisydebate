import { createId } from '@paralleldrive/cuid2';
import type { BrowserContext, Page } from '@playwright/test';
import {
  buildRoomTopic,
  roomCatalogChoiceSchema,
  roomViewSchema,
  roomCreateSchema,
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
  type RoomView,
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
import { nativeRealtimeRefusals } from './support/realtime-native-refusals';

requireLaunchSlot(resolve(import.meta.dirname, '../../..'), process.env);

function changeDetails(context: BrowserContext, view: RoomView, title: string) {
  return context.request.post(`/api/rooms/${view.id}/commands`, {
    headers: { origin },
    data: {
      type: 'update-details',
      commandId: createId(),
      expectedVersion: view.version,
      title,
      topic: view.topic,
      visibility: 'private',
    },
  });
}

function roomChanges(page: Page, version: number) {
  return page.evaluate(
    (version) =>
      window.realtimeProof.frames.filter(
        (frame) =>
          frame.type === 'event' &&
          frame.payload.kind === 'room.changed' &&
          frame.payload.entityVersion === version,
      ),
    version,
  );
}

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
      data: roomCreateSchema.parse({
        commandId: createId(),
        title: 'Realtime isolated proof',
        topic: 'Cities should fund public transit',
        visibility: 'private',
        selection: {
          kind: 'catalog',
          formatId: choice.formatId,
          formatVersion: choice.formatVersion,
          length: 'full',
          competitionType: 'casual',
          config: choice.defaultConfig,
        },
      }),
    });
    expect(created.status()).toBe(201);
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
        hostPage.evaluate(() => {
          const proof = window.realtimeProof;
          if (proof.frames.some((frame) => frame.type === 'subscribed'))
            return null;
          return {
            state: proof.store.getState(),
            closeCodes: proof.closeCodes,
            diagnostics: proof.diagnostics,
            frames: proof.transportFrames.map((frame) => ({
              type: frame.type,
              ...(frame.type === 'error' ? { code: frame.code } : {}),
            })),
          };
        }),
      )
      .toBe(null);
    await expect
      .poll(() =>
        outsiderPage.evaluate(() =>
          window.realtimeProof.frames.some(
            (frame) => frame.type === 'error' && frame.code === 'AUTHORIZATION',
          ),
        ),
      )
      .toBe(true);
    const mutation = await changeDetails(
      host,
      before,
      'Changed only through HTTP',
    );
    expect(mutation.status()).toBe(200);
    const changed = roomViewSchema.parse((await mutation.json()).view);
    await expect
      .poll(
        async () => (await roomChanges(hostPage, changed.changeVersion)).length,
      )
      .toBe(1);
    const bell = (await roomChanges(hostPage, changed.changeVersion))[0];
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
    // Hold only the next real ticket HTTP request while a durable command commits.
    // Reconnection must consume that real ticket and catch up from its stored cursor.
    let resumeTicket!: () => void;
    let ticketRequested = false;
    const ticketGate = new Promise<void>((resolve) => {
      resumeTicket = resolve;
    });
    await hostPage.route('**/api/realtime/ticket', async (route) => {
      ticketRequested = true;
      await ticketGate;
      await route.continue();
    });
    await hostPage.evaluate(() => {
      window.realtimeProof.sockets.at(-1)!.close(4005, 'isolated interruption');
    });
    await expect.poll(() => ticketRequested).toBe(true);
    const offlineMutation = await changeDetails(
      host,
      changed,
      'Committed while the socket is disconnected',
    );
    expect(offlineMutation.status()).toBe(200);
    const offlineView = roomViewSchema.parse(
      (await offlineMutation.json()).view,
    );
    resumeTicket();
    await expect
      .poll(
        async () =>
          (await roomChanges(hostPage, offlineView.changeVersion)).length,
      )
      .toBe(1);
    await expect
      .poll(() =>
        hostPage.evaluate(
          () =>
            window.realtimeProof.frames.filter(
              (frame) => frame.type === 'subscribed',
            ).length,
        ),
      )
      .toBe(2);
    expect(
      await hostPage.evaluate(() => window.realtimeProof.sockets.length),
    ).toBe(2);
    await hostPage.unroute('**/api/realtime/ticket');
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

test('actual authenticated socket enforces version, hello deadline, malformed frames and inbound rate', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const page = await openPage(
      accounts.members[0]!.context,
      'RT native refusals',
    );
    await page.goto('/lobby');
    const result = await nativeRealtimeRefusals(
      page,
      `wss://localhost:${resolveE2EPorts(process.env).realtime}/ws`,
    );
    expect(result).toEqual({
      version: 4003,
      timeout: 4001,
      malformed: 4003,
      rate: 4004,
    });
  } finally {
    await settledLaunchAuth();
    await accounts.closeContexts();
  }
});
