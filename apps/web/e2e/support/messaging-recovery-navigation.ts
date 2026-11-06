import type { Page } from '@playwright/test';
import { systemClock } from '@daisy/clock';
import { expect, test } from './fixtures';
import { boundedStep } from './bounded-step';
import {
  acceptMessagingJourney,
  openMessagingJourney,
} from './messaging-journey';
import {
  control,
  composer,
  refused,
  evidence,
} from './messaging-recovery-driver';
import { watchConversationRecovery } from './messaging-recovery-evidence';
import { isMessagingRefetch } from './messaging-page-locators';
import { effectsRan } from './hydration';

const pause = async (page: Page) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date(systemClock.now()));
};
async function holdDestination(page: Page, path: string) {
  const held = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  let captured = false;
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      if (captured || !isMessagingRefetch(route.request().headers()))
        return route.continue();
      captured = true;
      const response = await route.fetch();
      held.resolve();
      await gate.promise;
      await route.fulfill({ response });
    },
  );
  return {
    entered: () =>
      boundedStep('the real held RSC destination', () => held.promise),
    release: gate.resolve,
  };
}

export function testMessagingRecoveryNavigation() {
  test('accepted shell navigation owns a held destination across the waiting Messaging retry', async ({
    browser,
  }, info) => {
    const journey = await openMessagingJourney(browser);
    let release = () => {};
    let observer: ReturnType<typeof watchConversationRecovery> | undefined;
    try {
      const page = await acceptMessagingJourney(journey);
      await effectsRan(page);
      await pause(page);
      observer = watchConversationRecovery(page, journey.channelId);
      await control('refuse-messaging-history');
      await page.goto(`/messages/${journey.channelId}`);
      await expect(refused(page)).toBeVisible();
      const held = await holdDestination(page, '/');
      release = held.release;
      observer.phase('member choice with held destination');
      observer.memberNavigation();
      await page
        .getByRole('link', { name: 'Home', exact: true })
        .first()
        .click();
      await held.entered();
      await page.clock.fastForward(12000);
      expect(observer.snapshot()).toMatchObject({
        dispatches: 0,
        otherDispatches: 1,
        pending: 1,
      });
      await control('allow-messaging-reads');
      release();
      await expect(page).toHaveURL(/\/$/);
      await page.clock.fastForward(12000);
      expect(observer.snapshot()).toMatchObject({
        dispatches: 0,
        otherDispatches: 1,
      });
      await evidence(info, observer);
    } finally {
      release();
      await control('allow-messaging-reads');
      observer?.stop();
      await journey.close();
    }
  });

  test('cancelled and new-tab shell choices plus a no-destination action keep Messaging recovery alive', async ({
    browser,
  }, info) => {
    const journey = await openMessagingJourney(browser);
    let observer: ReturnType<typeof watchConversationRecovery> | undefined;
    try {
      const page = await acceptMessagingJourney(journey);
      await effectsRan(page);
      await pause(page);
      observer = watchConversationRecovery(page, journey.channelId);
      await control('refuse-messaging-history');
      await page.goto(`/messages/${journey.channelId}`);
      await expect(refused(page)).toBeVisible();
      const home = page
        .getByRole('link', { name: 'Home', exact: true })
        .first();
      await home.evaluate((link) =>
        link.addEventListener('click', (event) => event.preventDefault(), {
          once: true,
        }),
      );
      await home.click();
      await expect(page).toHaveURL(
        new RegExp(`/messages/${journey.channelId}$`),
      );
      await home.evaluate((link) => link.setAttribute('target', '_blank'));
      const popup = page.waitForEvent('popup');
      await home.click();
      await (await popup).close();
      await home.evaluate((link) => link.removeAttribute('target'));
      observer.phase('no-destination shell action');
      await page.getByRole('button', { name: 'Minimize', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Expand', exact: true }),
      ).toBeVisible();
      await expect(refused(page)).toBeVisible();
      expect(observer.snapshot().dispatches).toBe(0);
      await control('allow-messaging-reads');
      observer.phase('automatic recovery after retained choices');
      await page.clock.fastForward(1100);
      await expect(composer(page)).toBeVisible();
      expect(observer.snapshot()).toMatchObject({
        dispatches: 1,
        otherDispatches: 0,
      });
      await evidence(info, observer);
    } finally {
      await control('allow-messaging-reads');
      observer?.stop();
      await journey.close();
    }
  });

  test('a real People Message result owns its held same-URL destination before the retry timer', async ({
    browser,
  }, info) => {
    const journey = await openMessagingJourney(browser);
    let release = () => {};
    let observer: ReturnType<typeof watchConversationRecovery> | undefined;
    try {
      const page = await acceptMessagingJourney(journey);
      await effectsRan(page);
      await pause(page);
      observer = watchConversationRecovery(page, journey.channelId);
      await control('refuse-messaging-history');
      await page.goto(`/messages/${journey.channelId}`);
      await expect(refused(page)).toBeVisible();
      const rail = page.getByRole('complementary', {
        name: 'People',
        exact: true,
      });
      await rail
        .getByRole('button', {
          name: new RegExp(`^@${journey.senderUsername},`),
        })
        .click({ button: 'right' });
      const held = await holdDestination(
        page,
        `/messages/${journey.channelId}`,
      );
      release = held.release;
      await control('allow-messaging-reads');
      observer.phase('answered People Message same-URL choice');
      observer.memberNavigation();
      await page
        .getByRole('dialog', {
          name: `@${journey.senderUsername}`,
          exact: true,
        })
        .getByRole('button', { name: 'Message', exact: true })
        .click();
      await held.entered();
      await page.clock.fastForward(12000);
      expect(observer.snapshot()).toMatchObject({
        dispatches: 1,
        otherDispatches: 0,
        pending: 1,
      });
      release();
      await expect(composer(page)).toBeVisible();
      await composer(page).fill('The newer same-page draft');
      await page.clock.fastForward(12000);
      await expect(composer(page)).toHaveValue('The newer same-page draft');
      expect(observer.snapshot().dispatches).toBe(1);
      await evidence(info, observer);
    } finally {
      release();
      await control('allow-messaging-reads');
      observer?.stop();
      await journey.close();
    }
  });

  test('query navigation and Back never let the disposed Messaging owner refresh its successor', async ({
    browser,
  }, info) => {
    const journey = await openMessagingJourney(browser);
    let observer: ReturnType<typeof watchConversationRecovery> | undefined;
    try {
      const page = await acceptMessagingJourney(journey);
      await effectsRan(page);
      await pause(page);
      observer = watchConversationRecovery(page, journey.channelId);
      await control('refuse-messaging-history');
      await page.goto(`/messages/${journey.channelId}?query=missing`);
      await expect(refused(page)).toBeVisible();
      await control('allow-messaging-reads');
      observer.phase('member Back');
      observer.memberNavigation();
      await page.goBack();
      await expect(composer(page)).toBeVisible();
      await composer(page).fill('Back owns this draft');
      const observed = observer.snapshot().dispatches;
      await page.clock.fastForward(12000);
      await expect(composer(page)).toHaveValue('Back owns this draft');
      expect(observer.snapshot().dispatches).toBe(observed);
      await evidence(info, observer);
    } finally {
      await control('allow-messaging-reads');
      observer?.stop();
      await journey.close();
    }
  });
}
