import { proveHumanLaunch } from './support/room-launch-human';
import { createId } from '@paralleldrive/cuid2';
import { roomViewSchema, roundViewSchema } from '@daisy/protocol';
import { expect, test, openPage } from './support/fixtures';
import { origin } from './support/accounts';
import {
  reread,
  deniedCommand,
  createFromPlay,
  claim,
  prepareJudgeRoom,
} from './support/room-launch-flow';
import { launchCustomSelection } from './support/room-launch-custom';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { launchEvidence } from './support/room-launch-evidence';
import {
  closeSettledLaunchContexts,
  settledLaunchAuth,
} from './support/room-launch-settled';

// Actors, receipt and competitive history deliberately survive context closure.
// Only a released suite-owned slot lifecycle can destroy this proof data.
test('canonical browser create, settings, cast, refusals and reread preserve durable authority', async ({
  browser,
}, info) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const host = await openPage(accounts.members[0]!.context, 'Launch host');
    const guest = await openPage(accounts.members[1]!.context, 'Launch guest');
    let view = await createFromPlay(
      host,
      `Launch proof ${createId().slice(0, 8)}`,
    );
    expect(view.formatVersion).toBeGreaterThan(0);
    expect(view.rules.segments.length).toBeGreaterThan(1);
    await guest.goto('/lobby');
    await expect(
      guest.getByRole('link', { name: view.title, exact: true }),
    ).toBeVisible();
    await guest.getByRole('link', { name: view.title, exact: true }).click();
    view = await claim(guest, view, 'Negative 1');
    await expect(
      guest.getByRole('button', { name: 'Save room details' }),
    ).toHaveCount(0);
    await expect(
      guest.getByRole('button', { name: 'Save settings' }),
    ).toHaveCount(0);
    await settledLaunchAuth();
    const before = await launchEvidence(view.id);
    const denied = await deniedCommand(guest.request, view, {
      type: 'update-details',
      title: 'Forbidden',
      topic: view.topic,
      visibility: view.visibility,
    });
    expect(denied.status()).toBe(403);
    const stale = await deniedCommand(
      host.request,
      { ...view, version: view.version - 1 },
      { type: 'close' },
    );
    expect(stale.status()).toBe(409);
    expect((await launchEvidence(view.id)).hash).toBe(before.hash);
    await host.goto(`/rooms/${view.id}`);
    const details = host.getByRole('form', { name: 'Room details' });
    await details
      .getByLabel('Room name', { exact: true })
      .fill('Stored Launch proof');
    await details.getByRole('button', { name: 'Save room details' }).click();
    await expect(
      host.getByRole('heading', { name: 'Stored Launch proof', exact: true }),
    ).toBeVisible();
    view = await reread(host.request, view.id);
    const settings = host.getByRole('form', { name: 'Room settings' });
    const first = view.rules.segments[0]!;
    const second = view.rules.segments[1]!;
    const firstMs =
      view.definition.configurable.timing.segmentDurationMs[first.key]!.min;
    const secondBounds =
      view.definition.configurable.timing.segmentDurationMs[second.key]!;
    const secondMs = Math.max(
      secondBounds.min,
      Math.min(secondBounds.max, firstMs + 1000),
    );
    expect(firstMs).not.toBe(secondMs);
    await settings
      .locator(`[name="seconds.${first.key}"]`)
      .fill(String(firstMs / 1000));
    await settings
      .locator(`[name="seconds.${second.key}"]`)
      .fill(String(secondMs / 1000));
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(async () => {
      view = await reread(host.request, view.id);
      expect(view.rules.segments.slice(0, 2).map((s) => s.durationMs)).toEqual([
        firstMs,
        secondMs,
      ]);
    }).toPass();
    view = await claim(host, view, 'Affirmative 1');
    await guest.reload();
    expect(await reread(guest.request, view.id)).toMatchObject({
      title: view.title,
      config: view.config,
      version: view.version,
    });
    await info.attach('retained-competitive-evidence', {
      body: JSON.stringify({
        candidate: process.env.GIT_COMMIT,
        ...(await launchEvidence(view.id)),
      }),
      contentType: 'application/json',
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('native judge Ready and eligible stored bot debaters launch one frozen scheduled Round', async ({
  browser,
}, info) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const context = accounts.members[0]!.context;
    const page = await openPage(context, 'bot Launch host');
    let view = await prepareJudgeRoom(
      page,
      `Bot proof ${createId().slice(0, 8)}`,
    );
    // Real same-account cookies in a JS-disabled context; no readiness injection.
    const native = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: false,
      storageState: await context.storageState(),
    });
    try {
      const judge = await openPage(native, 'native judge Ready');
      await judge.goto(`/rooms/${view.id}`);
      await expect(
        judge.getByRole('button', { name: 'I am ready', exact: true }),
      ).toBeEnabled();
      await judge
        .getByRole('button', { name: 'I am ready', exact: true })
        .click();
      view = await reread(native.request, view.id);
      expect(view.participants.find((p) => p.role === 'judge')!.ready).toBe(
        'ready',
      );
      expect(view.capabilities.canStart).toBe(true);
      const launchForm = judge
        .getByRole('button', { name: 'Launch', exact: true })
        .locator('..');
      const commandId = await launchForm
        .locator('[name="commandId"]')
        .inputValue();
      const expectedVersion = Number(
        await launchForm.locator('[name="expectedVersion"]').inputValue(),
      );
      await judge.getByRole('button', { name: 'Launch', exact: true }).click();
      await expect(judge).toHaveURL(/\/rounds\/[a-z0-9]+$/);
      const launched = await reread(native.request, view.id);
      expect(launched.roundRef).not.toBeNull();
      const receipt = await native.request.get(
        `/api/rounds/${launched.roundRef!.id}`,
      );
      expect(receipt.status()).toBe(200);
      const round = roundViewSchema.parse(await receipt.json());
      expect(round).toMatchObject({
        status: 'scheduled',
        startedAt: null,
        topic: view.topic,
        config: view.config,
      });
      const proof = await launchEvidence(view.id);
      expect(proof.frozen).toEqual([
        {
          status: 'scheduled',
          startedAt: null,
          topic: view.topic,
          config: view.config,
          rules: view.rules,
          cast: view.participants.map((p) => p.actorId).sort(),
        },
      ]);
      expect(proof.launchDoorbells).toBe(1);
      const retry = await native.request.post(
        `/api/rooms/${view.id}/commands`,
        {
          headers: { origin },
          data: { type: 'start-round', commandId, expectedVersion },
        },
      );
      expect(retry.status()).toBe(200);
      expect((await retry.json()).receipt.replayed).toBe(true);
      expect((await launchEvidence(view.id)).hash).toBe(proof.hash);
      await expect(judge).toHaveURL(`/rounds/${round.id}`);
      await expect(
        judge.getByText('Round · Scheduled', { exact: true }),
      ).toBeVisible();
      await info.attach('scheduled-round-evidence', {
        body: JSON.stringify(proof),
        contentType: 'application/json',
      });
    } finally {
      await native.close();
    }
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('canonical browser custom-create preserves declared unequal seats and ordered per-segment durations', async ({
  browser,
}, info) => {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const context = accounts.members[0]!.context;
    const page = await openPage(context, 'custom format host');
    const created = await context.request.post('/api/rooms', {
      headers: { origin },
      data: {
        commandId: createId(),
        title: 'Custom sequence proof',
        topic: 'Proof transit motion',
        visibility: 'public',
        selection: launchCustomSelection,
      },
    });
    expect(created.status()).toBe(201);
    let view = roomViewSchema.parse((await created.json()).view);
    expect(view.definition).toEqual(launchCustomSelection.definition);
    expect(
      view.rules.segments.map((segment) => [
        segment.key,
        segment.side,
        segment.slot,
        segment.durationMs,
      ]),
    ).toEqual([
      ['N1', 'negative', 0, 7000],
      ['A2', 'affirmative', 1, 13000],
      ['A1', 'affirmative', 0, 11000],
    ]);
    await page.goto(`/rooms/${view.id}`);
    await expect(
      page.getByLabel('Assign Affirmative 2', { exact: true }),
    ).toBeVisible();
    const settings = page.getByRole('form', { name: 'Room settings' });
    await settings.locator('[name="seconds.A2"]').fill('17');
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(async () => {
      view = await reread(context.request, view.id);
      expect(view.rules.segments.map((segment) => segment.durationMs)).toEqual([
        7000, 17000, 11000,
      ]);
    }).toPass();
    await page.reload();
    await expect(settings.locator('[name="seconds.A2"]')).toHaveValue('17');
    await settledLaunchAuth();
    await info.attach('custom-sequence-evidence', {
      body: JSON.stringify(await launchEvidence(view.id)),
      contentType: 'application/json',
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});

test('actual Room device checks gate human Ready, withdrawal and durable Launch', async ({
  browser,
}, info) => {
  await proveHumanLaunch(browser, info);
});
