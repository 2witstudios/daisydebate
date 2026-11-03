import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createId } from '@paralleldrive/cuid2';
import { test, expect, openPage } from './support/fixtures';
import {
  resetRateLimits,
  signUpMember,
  signUpWaitlisted,
} from './support/accounts';

const seed = (username: string) =>
  new Promise<{ roundId: string }>((resolve, reject) =>
    execFile(
      'bun',
      [
        fileURLToPath(
          new URL('./support/audience-round-worker.ts', import.meta.url),
        ),
        username,
      ],
      { timeout: 20000 },
      (error, stdout) =>
        error
          ? reject(new Error('Audience setup refused'))
          : resolve(JSON.parse(stdout) as { roundId: string }),
    ),
  );

/**
 * Every audience form with JavaScript off (SPECT-1.4, WATCH-12): these contexts
 * run no script at all, so a form only script can submit fails here.
 */
test('chat, reactions and reports work with no script, for an account never admitted', async ({
  browser,
}) => {
  const seeder = await browser.newContext({ javaScriptEnabled: false });
  const visitor = await browser.newContext({ javaScriptEnabled: false });
  const reader = await browser.newContext({ javaScriptEnabled: false });
  const page = await openPage(seeder, 'native audience poster');
  const stranger = await openPage(visitor, 'native audience visitor');
  const reporter = await openPage(reader, 'native audience reporter');
  try {
    await resetRateLimits(page.request);
    // Waitlisted: an account with a username and no admission.
    const poster = await signUpWaitlisted(page.request);
    await signUpWaitlisted(reporter.request);
    const { roundId } = await seed(poster.username);
    const here = `/audience/${roundId}`;

    await stranger.goto(here);
    await expect(stranger.getByText('to chat and react')).toBeVisible();
    await expect(stranger.getByRole('textbox')).toHaveCount(0);

    await page.goto(here);
    const line = `A line ${createId().slice(0, 8)}`;
    await page.getByLabel('Your message').fill(line);
    await page.getByRole('button', { name: 'Post' }).click();
    await page.waitForURL(`**${here}`);
    expect(page.url()).not.toContain(encodeURIComponent(line));
    await expect(page.getByText(line)).toBeVisible();

    await page.getByRole('button', { name: /^Sharp point/ }).click();
    await page.waitForURL(`**${here}`);
    await expect(
      page.getByRole('button', { name: 'Sharp point 1' }),
    ).toBeVisible();

    await stranger.goto(here);
    await expect(stranger.getByText(line)).toBeVisible();
    await expect(stranger.getByText('Sharp point 1')).toBeVisible();

    await reporter.goto(here);
    await reporter.getByText('Report', { exact: true }).click();
    await reporter.getByRole('button', { name: 'Send report' }).click();
    await reporter.waitForURL(`**${here}?report=*`);
    await expect(reporter.getByRole('status')).toBeVisible();
    expect(reporter.url()).toContain('report=received');
  } finally {
    await seeder.close();
    await visitor.close();
    await reader.close();
  }
});

test('following, notifications, stored preferences and history work with no script', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const other = await browser.newContext({ javaScriptEnabled: false });
  const page = await openPage(context, 'native audience member');
  const debaterPage = await openPage(other, 'native audience debater');
  try {
    await resetRateLimits(page.request);
    const member = await signUpMember(page.request);
    const debater = await signUpMember(debaterPage.request);
    await seed(member.username);

    await page.goto(`/profile/${debater.username}`);
    await page.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();
    await page.getByRole('button', { name: 'Following' }).click();
    await expect(
      page.getByRole('button', { name: 'Follow', exact: true }),
    ).toBeVisible();

    await page.goto('/notifications');
    await expect(page.getByText('1 unread.')).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Primary' })
        .first()
        .getByRole('link', {
          name: 'Notifications',
        }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Mark as read' }).click();
    await expect(page.getByText('You are all caught up.')).toBeVisible();

    await page.goto('/settings');
    const live = page.getByRole('checkbox', {
      name: 'A debater I follow is on air',
    });
    await expect(live).toBeChecked();
    await live.uncheck();
    await page
      .getByRole('form', { name: 'Notification preferences' })
      .getByRole('button', { name: 'Save' })
      .click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    await page.goto('/settings');
    await expect(
      page.getByRole('checkbox', { name: 'A debater I follow is on air' }),
    ).not.toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: 'A recording is ready to watch' }),
    ).toBeChecked();

    await expect(
      page.getByRole('link', { name: 'An audience proof resolution' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('You have not watched a Round.')).toBeVisible();
  } finally {
    await context.close();
    await other.close();
  }
});

/** The same forms with script on: each stays usable after its first answer. */
test('with script, every form answers more than once and the view refreshes itself', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await openPage(context, 'audience member with script');
  const debaterContext = await browser.newContext();
  const debaterPage = await openPage(debaterContext, 'audience debater');
  try {
    await resetRateLimits(page.request);
    const member = await signUpMember(page.request);
    const debater = await signUpMember(debaterPage.request);
    const { roundId } = await seed(member.username);

    await page.goto(`/audience/${roundId}`);
    for (const line of [
      `First ${createId().slice(0, 8)}`,
      `Second ${createId().slice(0, 8)}`,
    ]) {
      await page.getByLabel('Your message').fill(line);
      await page.getByRole('button', { name: 'Post' }).click();
      await expect(page.getByText(line)).toBeVisible();
      await expect(page.getByLabel('Your message')).toHaveValue('');
      await expect(page.getByRole('button', { name: 'Post' })).toBeEnabled();
    }
    const sharp = page.getByRole('button', { name: /^Sharp point/ });
    await sharp.click();
    await expect(
      page.getByRole('button', { name: 'Sharp point 1' }),
    ).toBeEnabled();

    await page.goto(`/profile/${debater.username}`);
    await page.getByRole('button', { name: 'Follow', exact: true }).click();
    const following = page.getByRole('button', { name: 'Following' });
    await expect(following).toBeEnabled();
    await following.click();
    await expect(
      page.getByRole('button', { name: 'Follow', exact: true }),
    ).toBeEnabled();

    await page.goto('/notifications');
    await page.getByRole('button', { name: 'Mark as read' }).click();
    await expect(page.getByText('You are all caught up.')).toBeVisible();

    await page.goto('/settings');
    await page
      .getByRole('form', { name: 'Notification preferences' })
      .getByRole('button', { name: 'Save' })
      .click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    await page.getByRole('button', { name: 'Clear history' }).click();
    await expect(page.getByText('You have not watched a Round.')).toBeVisible();
  } finally {
    await context.close();
    await debaterContext.close();
  }
});
