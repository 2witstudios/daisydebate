import type { Browser, Page } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import { roomCatalogChoiceSchema } from '@daisy/protocol/room-read';
import { type RoomCatalogChoice } from '@daisy/protocol/room-contract';
import { expect, openPage } from './fixtures';
import { hydrated } from './hydration';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import { closeSettledLaunchContexts } from './room-launch-settled';
import { clockText, createConfiguredRoom } from './room-launch-flow';

/** The rendered schedule must show the catalog's actual ordered speech defaults. */
async function expectTemplatePreview(page: Page, chosen: RoomCatalogChoice) {
  const preview = page.getByRole('complementary', { name: 'Room preview' });
  await expect(preview).toContainText(`Based on ${chosen.label}`);
  const rows = preview.locator('dl > div');
  const prep = chosen.preset.config.preRoundPrep;
  const offset = prep.enabled ? 1 : 0;
  await expect(rows).toHaveCount(
    chosen.definition.segments.length + offset + 3,
  );
  if (prep.enabled) {
    await expect(rows.nth(0).locator('dt')).toHaveText('Prep before the round');
    await expect(rows.nth(0).locator('dd')).toHaveText(
      clockText(prep.durationMs),
    );
  }
  for (const [index, segment] of chosen.definition.segments.entries()) {
    const row = rows.nth(index + offset);
    await expect(row.locator('dt')).toHaveText(segment.label);
    await expect(row.locator('dd')).toHaveText(
      clockText(
        chosen.preset.config.speechTiming.segmentDurationOverrides[
          segment.key
        ] ?? segment.defaultDurationMs,
      ),
    );
  }
}

export async function proveFormatPicker(browser: Browser) {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  const host = accounts.members[0]!.context;
  try {
    const page = await openPage(host, 'Custom library host');
    await page.goto('/play/room');
    const catalog = await page.request.get('/api/rooms/catalog');
    expect(catalog.status()).toBe(200);
    const choices = roomCatalogChoiceSchema
      .array()
      .parse((await catalog.json()).choices);
    const chosen = choices
      .filter((choice) => choice.role === 'template')
      .at(-1);
    if (!chosen)
      throw new Error('Custom library proof needs an actual league template');
    const key = `${chosen.formatId}@${chosen.formatVersion}@${chosen.preset.version}`;
    const form = page.getByRole('form', { name: 'Create a room' });
    await hydrated(form);
    await form.locator('[name="format"][value="custom"]').check();
    const disclosure = form.getByText('Start from a league template', {
      exact: true,
    });
    const before = await form.locator('[name="basis"]').inputValue();
    await disclosure.click();
    const templates = form.getByRole('combobox', {
      name: 'League template',
      exact: true,
    });
    await expect(templates.locator('option')).toHaveCount(
      choices.filter((choice) => choice.role === 'template').length + 1,
    );
    // Browsing and dismissing the library never changes the current draft.
    await disclosure.click();
    await expect(form.locator('[name="basis"]')).toHaveValue(before);
    await expect(disclosure).toBeFocused();
    await disclosure.click();
    await templates.selectOption(key);
    await expect(form.locator('[name="basis"]')).toHaveValue(key);
    await expectTemplatePreview(page, chosen);

    // The chosen template is what the Room is created with.
    await expect(form.locator('[name="format"][value="custom"]')).toBeChecked();
    await expect(
      form.getByRole('checkbox', { name: 'Ranked', exact: true }),
    ).toBeDisabled();
    await form
      .getByLabel('Room name', { exact: true })
      .fill(`Library ${createId().slice(0, 8)}`);
    if (!chosen.preset.config.resolutionDraw.enabled)
      await form
        .getByLabel('Custom resolution', { exact: true })
        .fill('Proof cities should fund transit');
    const stored = await createConfiguredRoom(page);
    expect(stored.competitionType).toBe('casual');
    expect(stored.format.standing.kind).toBe('custom');
    expect(stored.format.basis).toMatchObject({
      formatId: chosen.formatId,
      formatVersion: chosen.formatVersion,
      presetVersion: chosen.preset.version,
    });
    expect(stored.config).toEqual(chosen.preset.config);
    expect(stored.definition.seats).toEqual(chosen.definition.seats);
    expect(stored.definition.segments).toEqual(chosen.definition.segments);
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
}
