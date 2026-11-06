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
import type { Page } from '@playwright/test';

/** Resolve HostRoot.current, then read only the committed refusal's ancestor props. */
const refusalRenderId = (page: Page) =>
  refused(page).evaluate((element) => {
    type Fiber = {
      readonly memoizedProps?: {
        readonly requestId?: unknown;
        readonly retryAfterMs?: unknown;
      };
      readonly return?: Fiber | null;
      readonly child?: Fiber | null;
      readonly sibling?: Fiber | null;
      readonly stateNode?: unknown;
    };
    const key = Object.keys(element).find((name) =>
      name.startsWith('__reactFiber$'),
    );
    let root =
      key === undefined
        ? undefined
        : (element as unknown as Record<string, Fiber>)[key];
    for (let depth = 0; root?.return && depth < 100; depth += 1)
      root = root.return;
    const current = (
      root?.stateNode as { readonly current?: Fiber } | undefined
    )?.current;
    if (!current) throw new Error('Current mounted React root unavailable');
    const pending: { fiber: Fiber; path: readonly Fiber[] }[] = [
      { fiber: current, path: [] },
    ];
    for (let visited = 0; pending.length > 0 && visited < 20000; visited += 1) {
      const { fiber, path } = pending.pop()!;
      if (fiber.stateNode === element) {
        for (const ancestor of [...path, fiber].reverse()) {
          const props = ancestor.memoizedProps;
          if (
            typeof props?.requestId === 'string' &&
            /^[a-z0-9]{24}$/.test(props.requestId) &&
            typeof props.retryAfterMs === 'number'
          )
            return props.requestId;
        }
        throw new Error('Committed refusal owner unavailable');
      }
      if (fiber.sibling) pending.push({ fiber: fiber.sibling, path });
      if (fiber.child)
        pending.push({ fiber: fiber.child, path: [...path, fiber] });
    }
    throw new Error('Refusal DOM node absent from current React tree');
  });

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

  test('an unrelated real render cannot settle a held Messaging refresh or reset its remaining budget', async ({
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
      const before = await refusalRenderId(page);
      observer.phase('unrelated shell action while recovery is held');
      await page.getByRole('button', { name: 'Minimize', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Expand', exact: true }),
      ).toBeVisible();
      await expect
        .poll(async () => (await refusalRenderId(page)) !== before)
        .toBe(true);
      await info.attach('unrelated-render-observed', {
        contentType: 'application/json',
        body: JSON.stringify({ changedConversationRender: true }),
      });
      await page.clock.fastForward(12000);
      expect(observer.snapshot()).toMatchObject({
        dispatches: 1,
        maximumPending: 1,
        pending: 1,
      });
      observer.phase('held refusal released in place');
      release();
      await expect(
        page.getByText('This conversation is still unavailable. Try again.', {
          exact: true,
        }),
      ).toBeVisible({ timeout: 10000 });
      expect(observer.snapshot()).toMatchObject({
        dispatches: 3,
        otherDispatches: 0,
        maximumPending: 1,
        pending: 0,
      });
      observer.phase('exhausted owner after unrelated render');
      await page.clock.fastForward(12000);
      expect(observer.snapshot().dispatches).toBe(3);
      await evidence(info, observer);
    } finally {
      release();
      await control('allow-messaging-reads');
      observer?.stop();
      await journey.close();
    }
  });
}
