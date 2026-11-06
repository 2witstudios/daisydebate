import {
  control,
  composer,
  refused,
  evidence,
} from './messaging-recovery-driver';
import { testMessagingRecoveryNavigation } from './messaging-recovery-navigation';
import { expect, test, openPage } from './fixtures';
import {
  acceptMessagingJourney,
  openMessagingJourney,
} from './messaging-journey';
import { watchConversationRecovery } from './messaging-recovery-evidence';
import { effectsRan } from './hydration';
import { isMessagingRefetch } from './messaging-page-locators';
import { boundedStep } from './bounded-step';

/** Actual web-process admission, production Next/TLS/auth and unchanged test budgets. */
export function testMessagingRecovery() {
  testMessagingRecoveryNavigation();
  for (const target of ['history', 'entry'] as const)
    test(`a temporarily refused Messaging ${target} recovers without member refresh`, async ({
      browser,
    }, info) => {
      const journey = await openMessagingJourney(browser);
      let observer: ReturnType<typeof watchConversationRecovery> | undefined;
      try {
        const page = await acceptMessagingJourney(journey);
        await effectsRan(page);
        await page.clock.install();
        observer = watchConversationRecovery(page, journey.channelId);
        await control(
          target === 'history'
            ? 'refuse-messaging-history'
            : 'refuse-messaging-entry',
        );
        await page.goto(`/messages/${journey.channelId}`);
        await expect(refused(page)).toBeVisible();
        await expect(composer(page)).toHaveCount(0);
        await control('allow-messaging-reads');
        await expect(composer(page)).toBeVisible();
        await composer(page).fill('A recovered draft stays here');
        await page.clock.fastForward(12000);
        await expect(composer(page)).toHaveValue(
          'A recovered draft stays here',
        );
        expect(observer.snapshot()).toMatchObject({
          dispatches: 1,
          maximumPending: 1,
        });
        const observed = await evidence(info, observer);
        expect(observed.failures).toContainEqual(
          expect.objectContaining({
            operation:
              target === 'history'
                ? 'messaging.history'
                : 'messaging.channel.entry',
            status: 503,
            errorCode: 'INFRASTRUCTURE',
            admission: 'social.expired',
          }),
        );
      } finally {
        await control('allow-messaging-reads');
        observer?.stop();
        await journey.close();
      }
    });

  test('persistent Messaging admission refusal stops after three sequential automatic reads', async ({
    browser,
  }, info) => {
    const journey = await openMessagingJourney(browser);
    let observer: ReturnType<typeof watchConversationRecovery> | undefined;
    try {
      const page = await acceptMessagingJourney(journey);
      await effectsRan(page);
      await page.clock.install();
      observer = watchConversationRecovery(page, journey.channelId);
      await control('refuse-messaging-history');
      await page.goto(`/messages/${journey.channelId}`);
      await expect(
        page.getByText('This conversation is still unavailable. Try again.', {
          exact: true,
        }),
      ).toBeVisible({ timeout: 10000 });
      await page.clock.fastForward(12000);
      expect(observer.snapshot()).toMatchObject({
        dispatches: 3,
        maximumPending: 1,
        pending: 0,
      });
      await expect(composer(page)).toHaveCount(0);
      const observed = await evidence(info, observer);
      expect(
        observed.failures.filter(
          (failure) => failure.operation === 'messaging.history',
        ),
      ).toHaveLength(4);
      expect(
        observed.failures
          .filter((failure) => failure.operation === 'messaging.history')
          .every((failure) => failure.admission === 'social.expired'),
      ).toBe(true);
    } finally {
      await control('allow-messaging-reads');
      observer?.stop();
      await journey.close();
    }
  });

  test('native Messaging refusal offers a fresh authorized GET', async ({
    browser,
  }, info) => {
    const journey = await openMessagingJourney(browser, false);
    let observer: ReturnType<typeof watchConversationRecovery> | undefined;
    try {
      const page = await acceptMessagingJourney(journey);
      observer = watchConversationRecovery(page, journey.channelId);
      await control('refuse-messaging-history');
      await page.goto(`/messages/${journey.channelId}`);
      await expect(refused(page)).toBeVisible();
      await control('allow-messaging-reads');
      await page.getByRole('link', { name: 'Try again', exact: true }).click();
      await expect(composer(page)).toBeVisible();
      expect(observer.snapshot().dispatches).toBe(0);
      await evidence(info, observer);
    } finally {
      await control('allow-messaging-reads');
      observer?.stop();
      await journey.close();
    }
  });

  test('permanent Messaging denial shows no history and starts no automatic owner', async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser);
    try {
      await acceptMessagingJourney(journey);
      const outsider = await openPage(
        journey.outsider,
        'the denied Messaging reader',
      );
      const observer = watchConversationRecovery(outsider, journey.channelId);
      try {
        await outsider.clock.install();
        await outsider.goto(`/messages/${journey.channelId}`);
        await effectsRan(outsider);
        await expect(
          outsider.getByText(
            'This conversation is unavailable. Refresh to try again.',
            { exact: true },
          ),
        ).toBeVisible();
        await expect(composer(outsider)).toHaveCount(0);
        await expect(
          outsider.getByText(journey.introduction, { exact: true }),
        ).toHaveCount(0);
        await outsider.clock.fastForward(12000);
        expect(observer.snapshot().dispatches).toBe(0);
      } finally {
        observer.stop();
      }
    } finally {
      await journey.close();
    }
  });

  test('a held Messaging refresh neither overlaps nor overrides a newer shell choice', async ({
    browser,
  }, info) => {
    const journey = await openMessagingJourney(browser);
    let release = () => {};
    let observer: ReturnType<typeof watchConversationRecovery> | undefined;
    try {
      const page = await acceptMessagingJourney(journey);
      await effectsRan(page);
      await page.clock.install();
      const held = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      release = gate.resolve;
      let captured = false;
      await page.route(`**/messages/${journey.channelId}?*`, async (route) => {
        if (captured || !isMessagingRefetch(route.request().headers()))
          return route.continue();
        captured = true;
        const response = await route.fetch();
        held.resolve();
        await gate.promise;
        await route.fulfill({ response });
      });
      observer = watchConversationRecovery(page, journey.channelId);
      await control('refuse-messaging-history');
      await page.goto(`/messages/${journey.channelId}`);
      await expect(refused(page)).toBeVisible();
      await boundedStep('the held real recovery response', () => held.promise);
      observer.phase('unrelated shell action while recovery is held');
      await page.getByRole('button', { name: 'Minimize', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Expand', exact: true }),
      ).toBeVisible();
      await page.clock.fastForward(12000);
      expect(observer.snapshot()).toMatchObject({
        dispatches: 1,
        maximumPending: 1,
        pending: 1,
      });
      await control('allow-messaging-reads');
      observer.phase('member departure while recovery is held');
      observer.memberNavigation();
      await page
        .getByRole('link', { name: 'Home', exact: true })
        .first()
        .click();
      await expect(page).toHaveURL(/\/$/);
      release();
      await page.clock.fastForward(12000);
      await expect(page).toHaveURL(/\/$/);
      expect(observer.snapshot().dispatches).toBe(1);
      await evidence(info, observer);
    } finally {
      release();
      await control('allow-messaging-reads');
      observer?.stop();
      await journey.close();
    }
  });
}
