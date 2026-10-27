import type { Browser } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import { roomCatalogChoiceSchema, roomViewSchema } from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { origin } from './accounts';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import { reread } from './room-launch-flow';

/**
 * Room setup's format choice with scripts off (FMT-3, FMT-4): a Value room
 * whose prep was edited reads Custom based on Value, Back to Value restores
 * the standard, and choosing Policy posts select-format natively.
 */
export async function proveNoScriptFormatChoice(browser: Browser) {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  const host = accounts.members[0]!;
  const noScript = await browser.newContext({
    baseURL: origin,
    javaScriptEnabled: false,
    storageState: await host.context.storageState(),
  });
  try {
    const catalog = await host.context.request.get('/api/rooms/catalog');
    const value = (await catalog.json()).choices
      .map((c: unknown) => roomCatalogChoiceSchema.parse(c))
      .find((c: { formatId: string }) => c.formatId === 'value');
    if (!value) throw new Error('Value missing from the catalog');
    const created = await host.context.request.post('/api/rooms', {
      headers: { origin },
      data: {
        commandId: createId(),
        title: `Format proof ${createId().slice(0, 8)}`,
        topic: 'Proof cities should fund transit',
        visibility: 'public',
        selection: {
          kind: 'catalog',
          formatId: value.formatId,
          formatVersion: value.formatVersion,
          presetVersion: value.preset.version,
          competitionType: 'casual',
        },
      },
    });
    expect(created.status()).toBe(201);
    const room = roomViewSchema.parse((await created.json()).view);
    const edited = await host.context.request.post(
      `/api/rooms/${room.id}/commands`,
      {
        headers: { origin },
        data: {
          type: 'update-config',
          commandId: createId(),
          expectedVersion: room.version,
          config: {
            ...room.config,
            inRoundPrep: { enabled: true, budgetMsPerSide: 300_000 },
          },
        },
      },
    );
    expect(edited.status()).toBe(200);

    const page = await openPage(noScript, 'format choice, no JavaScript');
    await page.goto(`/rooms/${room.id}#room-setup`);
    const custom = page.getByRole('region', { name: 'Custom format' });
    await expect(custom.getByText('Custom, based on Value')).toBeVisible();
    await expect(custom.getByText('Prep per side 4:00 → 5:00')).toBeVisible();
    await custom.getByRole('button', { name: 'Back to Value' }).click();
    await expect
      .poll(async () => (await reread(page.request, room.id)).format.standing)
      .toEqual({ kind: 'standard', formatId: 'value' });

    await page.goto(`/rooms/${room.id}#room-setup`);
    await page.getByRole('radio', { name: /^Policy/ }).check();
    await page.getByRole('button', { name: 'Use this format' }).click();
    await expect
      .poll(async () => (await reread(page.request, room.id)).formatId)
      .toBe('policy');
  } finally {
    await noScript.close();
    await accounts.closeContexts();
  }
}
