import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createId } from '@paralleldrive/cuid2';
import { test, expect, openPage } from './support/fixtures';
import {
  resetRateLimits,
  signUpMember,
  signUpWaitlisted,
} from './support/accounts';

const seed = (username: string, ...options: readonly string[]) =>
  new Promise<{ roundId: string }>((resolve, reject) =>
    execFile(
      'bun',
      [
        fileURLToPath(
          new URL('./support/audience-round-worker.ts', import.meta.url),
        ),
        username,
        ...options,
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
    // Held: the timeline has not started, so the feed has released nothing.
    const { roundId } = await seed(poster.username, 'held');
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

const LIVE_ROOM_COPY =
  'You are in this Round’s live room, so you cannot post in its chat. The audience watches on a delay.';

test('anyone in the live room is told why they cannot post, with no script', async ({
  browser,
}) => {
  const hostContext = await browser.newContext({ javaScriptEnabled: false });
  const debaterContext = await browser.newContext({ javaScriptEnabled: false });
  const hostPage = await openPage(hostContext, 'native audience host');
  const debaterPage = await openPage(debaterContext, 'native audience debater');
  try {
    await resetRateLimits(hostPage.request);
    const host = await signUpWaitlisted(hostPage.request);
    const debater = await signUpWaitlisted(debaterPage.request);
    const { roundId } = await seed(
      debater.username,
      'held',
      `host=${host.username}`,
    );
    const here = `/audience/${roundId}`;

    await hostPage.goto(here);
    await expect(hostPage.getByText(LIVE_ROOM_COPY)).toBeVisible();
    await expect(hostPage.getByRole('textbox')).toHaveCount(0);

    // A form rendered before they took a seat is refused, and stores nothing.
    await debaterPage.goto(here);
    await debaterPage.getByLabel('Your message').fill('A draft');
    await seed('seat', debater.username, roundId, 'affirmative');
    await debaterPage.getByRole('button', { name: 'Post' }).click();
    await expect(debaterPage.getByText(LIVE_ROOM_COPY)).toBeVisible();
    await expect(debaterPage.getByRole('textbox')).toHaveCount(0);
    await expect(debaterPage.getByText('No messages yet.')).toBeVisible();
  } finally {
    await hostContext.close();
    await debaterContext.close();
  }
});

test('an unlisted Round opens to its link alone, for every audience form, with no script', async ({
  browser,
  baseURL,
}) => {
  const token = 'k'.repeat(21) + createId().slice(0, 22);
  const holderContext = await browser.newContext({ javaScriptEnabled: false });
  const strangerContext = await browser.newContext({
    javaScriptEnabled: false,
  });
  const holder = await openPage(holderContext, 'native audience link holder');
  const stranger = await openPage(strangerContext, 'native audience stranger');
  try {
    await resetRateLimits(holder.request);
    const holderAccount = await signUpWaitlisted(holder.request);
    await signUpWaitlisted(stranger.request);
    const { roundId } = await seed(
      holderAccount.username,
      'held',
      `link=${token}`,
    );
    const here = `/audience/${roundId}`;
    await holderContext.addCookies([
      {
        name: `daisy_audience_link_${roundId}`,
        value: token,
        url: baseURL!,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    const page = await stranger.goto(here);
    expect(page?.status()).toBe(404);

    await holder.goto(here);
    const line = `A linked line ${createId().slice(0, 8)}`;
    await holder.getByLabel('Your message').fill(line);
    await holder.getByRole('button', { name: 'Post' }).click();
    await holder.waitForURL(`**${here}`);
    await expect(holder.getByText(line)).toBeVisible();
    await holder.getByRole('button', { name: /^Sharp point/ }).click();
    await holder.waitForURL(`**${here}`);
    await expect(
      holder.getByRole('button', { name: 'Sharp point 1' }),
    ).toBeVisible();

    const ask = (path: string, data: unknown) =>
      stranger.request.post(path, {
        headers: { origin: baseURL! },
        data,
      });
    const missing = createId();
    const report = (targetId: string) =>
      ask('/api/content-reports', {
        targetKind: 'round',
        targetId,
        reason: 'spam',
      });
    const answers = {
      chat: (
        await ask(`/api/rounds/${roundId}/chat`, {
          version: 1,
          requestId: createId(),
          text: 'A line',
        })
      ).status(),
      reaction: (
        await ask(`/api/rounds/${roundId}/reactions`, {
          version: 1,
          kind: 'sharp_point',
        })
      ).status(),
      report: (await report(roundId)).status(),
      missingReport: (await report(missing)).status(),
      read: (
        await stranger.request.get(`/api/rounds/${roundId}/audience`)
      ).status(),
    };
    expect(answers).toEqual({
      chat: 404,
      reaction: 404,
      report: 404,
      missingReport: 404,
      read: 404,
    });
    const held = await holder.request.get(`/watch/${roundId}`);
    expect(held.status()).toBe(200);
  } finally {
    await holderContext.close();
    await strangerContext.close();
  }
});

test('with script, an unlisted Round refreshes by its link', async ({
  browser,
  baseURL,
}) => {
  const token = 'k'.repeat(21) + createId().slice(0, 22);
  const readerContext = await browser.newContext();
  const posterContext = await browser.newContext();
  const reader = await openPage(readerContext, 'audience link reader');
  const poster = await openPage(posterContext, 'audience link poster');
  try {
    await resetRateLimits(poster.request);
    const account = await signUpWaitlisted(poster.request);
    const { roundId } = await seed(account.username, 'held', `link=${token}`);
    for (const context of [readerContext, posterContext])
      await context.addCookies([
        {
          name: `daisy_audience_link_${roundId}`,
          value: token,
          url: baseURL!,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
    await reader.goto(`/audience/${roundId}`);
    await expect(reader.getByText('No messages yet.')).toBeVisible();
    await poster.goto(`/audience/${roundId}`);
    const line = `A later line ${createId().slice(0, 8)}`;
    await poster.getByLabel('Your message').fill(line);
    await poster.getByRole('button', { name: 'Post' }).click();
    await expect(poster.getByText(line)).toBeVisible();
    await expect(reader.getByText(line)).toBeVisible({ timeout: 10_000 });
  } finally {
    await readerContext.close();
    await posterContext.close();
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
    const { roundId } = await seed(member.username, 'held');

    // A second reader's view takes the line from its own poll, within seconds.
    const watcherContext = await browser.newContext();
    const watcher = await openPage(watcherContext, 'audience watcher');
    await watcher.goto(`/audience/${roundId}`);
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
      await expect(watcher.getByText(line)).toBeVisible({ timeout: 10_000 });
    }
    await watcherContext.close();
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
