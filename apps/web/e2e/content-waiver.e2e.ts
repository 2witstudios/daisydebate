import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createId } from '@paralleldrive/cuid2';
import { casualCaptureNotice } from '../src/features/legal/agreements';
import { test, expect, openPage } from './support/fixtures';
import { systemClock } from '@daisy/clock';
import { resetRateLimits, signUpMember, youthBirth } from './support/accounts';
import {
  submitCreateRoom,
  closeRoom,
  rosterSeatName,
} from './support/room-launch-flow';

const seasons = () =>
  new Promise<void>((resolve, reject) =>
    execFile(
      'bun',
      [
        fileURLToPath(
          new URL('./support/rating-season-worker.ts', import.meta.url),
        ),
      ],
      { timeout: 20000 },
      (error) =>
        error ? reject(new Error('Season setup refused')) : resolve(),
    ),
  );

test('a ranked seat signs the content waiver without JavaScript', async ({
  browser,
}) => {
  await seasons();
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await openPage(context, 'native content waiver');
  try {
    await resetRateLimits(page.request);
    await signUpMember(page.request);
    await page.goto('/play/room');
    const room = await submitCreateRoom(
      page,
      `Ranked waiver ${createId().slice(0, 8)}`,
      'freestyle',
      true,
    );
    try {
      await page
        .getByRole('button', {
          name: `Take ${rosterSeatName(room, 'Affirmative 1')}`,
          exact: true,
        })
        .click();
      const waiver = page.getByRole('heading', {
        name: 'Sign the ranked content waiver',
      });
      // The waiver waits behind I'm ready, in its confirmation (ADR 0145).
      // The confirmation is found with includeHidden, so one closed but still
      // laid out on the page fails here (ADR 0153).
      const confirmation = page.getByRole('dialog', {
        name: 'Ready?',
        exact: true,
        includeHidden: true,
      });
      await expect(confirmation).toHaveCount(1);
      await expect(confirmation).toBeHidden();
      await expect(waiver).toBeHidden();
      await page
        .getByRole('button', { name: 'I’m ready', exact: true })
        .click();
      await expect(confirmation).toBeVisible();
      await expect(waiver).toBeVisible();
      await expect(
        page.getByText('has not been reviewed by counsel').first(),
      ).toBeVisible();
      await page
        .getByRole('checkbox', {
          name: 'I agree to the ranked content waiver for this season.',
        })
        .check();
      await page.getByRole('button', { name: 'Sign waiver' }).click();
      await expect(waiver).toHaveCount(0);
      // RCHAT-13: the signed waiver is the ranked agreement; no capture notice.
      await expect(page.getByText(casualCaptureNotice.text)).toHaveCount(0);
      await expect(
        page.getByText('stays after you close your account'),
      ).toHaveCount(0);
    } finally {
      await closeRoom(page.request, room.id);
    }
  } finally {
    await context.close();
  }
});

test('a Youth member’s ranked seat signs the Youth waiver, which licenses nothing (ADR 0159)', async ({
  browser,
}) => {
  await seasons();
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await openPage(context, 'Youth content waiver');
  try {
    await resetRateLimits(page.request);
    await signUpMember(page.request, youthBirth(systemClock.now()));
    await page.goto('/play/room');
    const room = await submitCreateRoom(
      page,
      `Youth ranked waiver ${createId().slice(0, 8)}`,
      'freestyle',
      true,
    );
    try {
      await page
        .getByRole('button', {
          name: `Take ${rosterSeatName(room, 'Affirmative 1')}`,
          exact: true,
        })
        .click();
      await page
        .getByRole('button', { name: 'I’m ready', exact: true })
        .click();
      const waiver = page.getByRole('heading', {
        name: 'Sign the Youth ranked content waiver',
      });
      await expect(waiver).toBeVisible();
      const dialog = page.getByRole('dialog', { name: 'Ready?', exact: true });
      await expect(dialog).toContainText('No licence to your content');
      await expect(dialog).not.toContainText('Daisy owns');
      await expect(dialog).not.toContainText('name and likeness in them');
      await page
        .getByRole('checkbox', {
          name: 'I agree to the Youth ranked content waiver for this season.',
        })
        .check();
      await page.getByRole('button', { name: 'Sign waiver' }).click();
      await expect(waiver).toHaveCount(0);
    } finally {
      await closeRoom(page.request, room.id);
    }
  } finally {
    await context.close();
  }
});
