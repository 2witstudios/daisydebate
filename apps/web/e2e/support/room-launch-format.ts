import type { Browser } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import { roomCatalogChoiceSchema } from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import { closeSettledLaunchContexts } from './room-launch-settled';
import { reread } from './room-launch-flow';

export async function proveFormatPicker(browser: Browser) {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const page = await openPage(
      accounts.members[0]!.context,
      'format picker host',
    );
    await page.goto('/play/room');
    const catalog = await page.request.get('/api/rooms/catalog');
    expect(catalog.status()).toBe(200);
    const body = await catalog.json();
    const choices = roomCatalogChoiceSchema.array().parse(body.choices);
    const chosen = choices.at(-1);
    if (!chosen)
      throw new Error('Format picker proof needs an actual catalog choice');
    const form = page.getByRole('form', { name: 'Create a room' });
    const native = form.getByLabel('Format template', { exact: true });
    const before = await native.inputValue();
    const browse = form.getByRole('button', {
      name: 'Browse formats',
      exact: true,
    });
    await browse.click();
    const dialog = page.getByRole('dialog', { name: 'Choose a format' });
    await dialog
      .getByRole('button', { name: chosen.label, exact: true })
      .click();
    const preview = dialog.getByRole('region', { name: 'Format preview' });
    const ordered = preview.getByRole('list').getByRole('listitem');
    await expect(ordered).toHaveCount(chosen.definition.segments.length);
    for (const [index, segment] of chosen.definition.segments.entries()) {
      await expect(ordered.nth(index)).toContainText(segment.label);
      const duration =
        chosen.defaultConfig.speechTiming.segmentDurationOverrides[
          segment.key
        ] ?? segment.defaultDurationMs;
      await expect(ordered.nth(index)).toContainText(`${duration / 1000} s`);
    }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(native).toHaveValue(before);
    await expect(browse).toBeFocused();
    await browse.click();
    await dialog
      .getByRole('button', { name: chosen.label, exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Use this format', exact: true })
      .click();
    const selected = JSON.parse(await native.inputValue());
    expect(selected).toMatchObject({
      formatId: chosen.formatId,
      formatVersion: chosen.formatVersion,
      config: chosen.defaultConfig,
    });
    await form
      .getByLabel('Room name', { exact: true })
      .fill(`Picker ${createId().slice(0, 8)}`);
    await form
      .getByLabel('Debate topic')
      .fill('Proof cities should fund transit');
    await form
      .getByRole('button', { name: 'Create room', exact: true })
      .click();
    await expect(page).toHaveURL(/\/rooms\/[a-z0-9]+$/);
    const id = new URL(page.url()).pathname.split('/').at(-1)!;
    const stored = await reread(page.request, id);
    expect(stored).toMatchObject({
      formatId: chosen.formatId,
      formatVersion: chosen.formatVersion,
      config: chosen.defaultConfig,
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
}
