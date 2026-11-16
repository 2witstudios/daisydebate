import type { Browser } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import { roomCatalogChoiceSchema, roomViewSchema } from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { origin } from './accounts';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import { reread } from './room-launch-flow';

/**
 * Room setup's format choice with scripts off (FMT-3, FMT-4, ADR 0142): a
 * Freestyle room whose prep was edited reads Custom based on Freestyle, Back
 * to Freestyle restores the standard, and the league browser posts
 * select-format natively with the resolution a set-wording format needs.
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
    const freestyle = (await catalog.json()).choices
      .map((c: unknown) => roomCatalogChoiceSchema.parse(c))
      .find((c: { formatId: string }) => c.formatId === 'freestyle');
    if (!freestyle) throw new Error('Freestyle missing from the catalog');
    const created = await host.context.request.post('/api/rooms', {
      headers: { origin },
      data: {
        commandId: createId(),
        title: `Format proof ${createId().slice(0, 8)}`,
        resolution: { kind: 'strike' },
        visibility: 'public',
        selection: {
          kind: 'catalog',
          formatId: freestyle.formatId,
          formatVersion: freestyle.formatVersion,
          presetVersion: freestyle.preset.version,
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
            preRoundPrep: { enabled: true, durationMs: 900_000 },
          },
        },
      },
    );
    expect(edited.status()).toBe(200);

    const page = await openPage(noScript, 'format choice, no JavaScript');
    await page.goto(`/rooms/${room.id}#room-setup`);
    const custom = page.getByRole('region', { name: 'Custom format' });
    await expect(custom.getByText('Custom, based on Freestyle')).toBeVisible();
    await expect(
      custom.getByText('Prep before the round 20:00 → 15:00'),
    ).toBeVisible();
    await custom.getByRole('button', { name: 'Back to Freestyle' }).click();
    await expect
      .poll(async () => (await reread(page.request, room.id)).format.standing)
      .toEqual({ kind: 'standard', formatId: 'freestyle' });

    // Freestyle and Custom are the only format radios; the league browser
    // is the way to a set-resolution format, so it asks for the wording.
    await page.goto(`/rooms/${room.id}#room-setup`);
    const radios = page
      .getByRole('radiogroup', { name: 'Format', exact: true })
      .getByRole('radio');
    await expect(radios).toHaveCount(2);
    await expect(radios.nth(0)).toBeChecked();
    const league = page.getByLabel('Start from a league format', {
      exact: true,
    });
    const option = league
      .locator('option')
      .filter({ hasText: 'NSDA Lincoln-Douglas' });
    await league.selectOption((await option.getAttribute('value'))!);
    const topic = 'Resolved: Civil disobedience is justified in a democracy.';
    await page.locator('#room-league-topic').fill(topic);
    await page.getByRole('button', { name: 'Start from this format' }).click();
    await expect
      .poll(async () => {
        const view = await reread(page.request, room.id);
        return [view.formatId, view.topic, view.format.standing.kind];
      })
      .toEqual(['nsda-ld', topic, 'custom']);
  } finally {
    await noScript.close();
    await accounts.closeContexts();
  }
}
