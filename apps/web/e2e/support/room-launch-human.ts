import type { Browser, TestInfo } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import { expect, openPage } from './fixtures';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import {
  createFromPlay,
  claim,
  reread,
  assertFrozenLaunch,
} from './room-launch-flow';
import { origin } from './accounts';
import {
  closeSettledLaunchContexts,
  settledLaunchAuth,
} from './room-launch-settled';

/** Actual getUserMedia/controller/UI over controlled Chromium inputs, not real-device qualification. */
export async function proveHumanLaunch(browser: Browser, info: TestInfo) {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    for (const { context } of accounts.members)
      await context.grantPermissions(['camera', 'microphone'], { origin });
    const host = await openPage(
      accounts.members[0]!.context,
      'human Ready host',
    );
    const guest = await openPage(
      accounts.members[1]!.context,
      'human Ready guest',
    );
    let view = await createFromPlay(
      host,
      `Human proof ${createId().slice(0, 8)}`,
    );
    view = await claim(host, view, 'Affirmative 1');
    view = await claim(guest, view, 'Negative 1');
    await host.reload();
    const native = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: false,
      storageState: await accounts.members[0]!.context.storageState(),
    });
    try {
      const failClosed = await openPage(
        native,
        'native human readiness refusal',
      );
      await failClosed.goto(`/rooms/${view.id}`);
      await expect(
        failClosed.getByRole('button', { name: 'I am ready', exact: true }),
      ).toBeDisabled();
      expect(
        (await reread(native.request, view.id)).readiness.readyActorIds,
      ).toEqual([]);
    } finally {
      await native.close();
    }
    for (const page of [host, guest]) {
      await expect(
        page.getByRole('button', { name: 'I am ready', exact: true }),
      ).toBeDisabled();
      await page
        .getByRole('button', { name: 'Check camera', exact: true })
        .click();
      await expect(
        page.getByText('Camera: passed', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'I am ready', exact: true }),
      ).toBeDisabled();
      await page
        .getByRole('button', { name: 'Check microphone', exact: true })
        .click();
      await expect(
        page.getByText('Microphone: passed', { exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel('Your local camera preview')).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'I am ready', exact: true }),
      ).toBeEnabled();
      await page
        .getByRole('button', { name: 'I am ready', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Not ready', exact: true }),
      ).toBeEnabled();
      await expect(page.getByLabel('Your local camera preview')).toBeVisible();
    }
    await expect(async () => {
      view = await reread(host.request, view.id);
      expect(view.readiness.readyActorIds.length).toBe(2);
      expect(view.capabilities.canStart).toBe(true);
    }).toPass();
    await expect(
      host.getByRole('button', { name: 'Launch', exact: true }),
    ).toBeEnabled();
    await guest.getByRole('button', { name: 'Not ready', exact: true }).click();
    await expect(
      guest.getByRole('button', { name: 'I am ready', exact: true }),
    ).toBeEnabled();
    await expect(async () => {
      view = await reread(host.request, view.id);
      expect(view.capabilities.canStart).toBe(false);
    }).toPass();
    await guest
      .getByRole('button', { name: 'I am ready', exact: true })
      .click();
    await expect(
      host.getByRole('button', { name: 'Launch', exact: true }),
    ).toBeEnabled();
    view = await reread(host.request, view.id);
    await host.getByRole('button', { name: 'Launch', exact: true }).click();
    await expect(host).toHaveURL(/\/rounds\/[a-z0-9]+$/);
    const proof = await assertFrozenLaunch(view);
    await settledLaunchAuth();
    await info.attach('controlled-input-human-launch-evidence', {
      body: JSON.stringify(proof),
      contentType: 'application/json',
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
}
