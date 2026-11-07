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
import {
  watchConversationRecovery,
  readMessagingAdmissionLog,
} from './messaging-recovery-evidence';
import {
  pauseMessagingRecovery,
  recoveryDeadline,
  settledRefusal,
  settledRefusalResponse,
  driveRefusalDeadlines,
} from './messaging-recovery-clock';
import { awaitMessagingOperations } from './messaging-completed-operations';
import { committedRefusalState } from './messaging-committed-refusal';
import { effectsRan } from './hydration';
import { isMessagingRefetch } from './messaging-page-locators';
import { boundedStep, STEP_LIMIT_MS } from './bounded-step';
import { readControlledRefusal } from './messaging-controlled-refusal';
import { systemClock } from '@daisy/clock';
import { watchRecoveryConsumer } from './messaging-recovery-consumer';
import type { Page } from '@playwright/test';
import { watchRecoveredChannel } from './messaging-recovery-observation';
import { postMessage } from './messaging-content-requests';

const refusalRenderId = async (page: Page) =>
  (await refused(page).evaluate(committedRefusalState)).requestId;

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
        const accepted = await acceptMessagingJourney(journey);
        await accepted.close();
        const page = await openPage(
          journey.recipient,
          'the fresh refused conversation target',
        );
        const live = watchRecoveredChannel(page, journey.channelId);
        await page.clock.install();
        observer = watchConversationRecovery(page, journey.channelId);
        await control(
          target === 'history'
            ? 'refuse-messaging-history'
            : 'refuse-messaging-entry',
          journey.pressureSelectors,
        );
        await page.goto(`/messages/${journey.channelId}`);
        await expect(refused(page)).toBeVisible();
        await expect(composer(page)).toHaveCount(0);
        expect(live.snapshot()).toMatchObject({
          ready: false,
          revision: null,
          observes: 0,
        });
        await control('allow-messaging-reads');
        await expect(composer(page)).toBeVisible();
        const baseline = await live.ready();
        const requestId = await composer(page)
          .locator('xpath=ancestor::form')
          .locator('input[name="requestId"]')
          .inputValue();
        await composer(page).fill('A recovered draft stays here');
        observer.phase('fresh ready then authorized later revision');
        const later = await postMessage(
          journey.sender,
          journey,
          new URL(page.url()).origin,
          `A later live revision after ${target} recovery`,
        );
        expect(later.changeVersion).toBeGreaterThan(baseline);
        await live.heard(later.changeVersion);
        await expect(
          page
            .getByRole('list', { name: 'Message history', exact: true })
            .getByText(later.text, { exact: true }),
        ).toBeVisible();
        await expect(composer(page)).toHaveValue(
          'A recovered draft stays here',
        );
        await expect(
          composer(page)
            .locator('xpath=ancestor::form')
            .locator('input[name="requestId"]'),
        ).toHaveValue(requestId);
        await info.attach('recovered-target-observation', {
          contentType: 'application/json',
          body: JSON.stringify({
            ...live.snapshot(),
            baselineRevision: baseline,
            laterRevision: later.changeVersion,
            targetRenderedLaterMessage: true,
            draftAndRequestIdRetained: true,
          }),
        });
        // Clock advancement follows the current-base live proof: it can expire permits.
        await page.clock.fastForward(12000);
        await expect(composer(page)).toHaveValue(
          'A recovered draft stays here',
        );
        expect(observer.snapshot()).toMatchObject({
          dispatches: 1,
          otherDispatches: 0,
          historyGetRequests: 0,
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
        try {
          await control('allow-messaging-reads');
        } finally {
          observer?.stop();
          await journey.close();
        }
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
      await pauseMessagingRecovery(page);
      const consumer = await watchRecoveryConsumer(page, journey.channelId);
      observer = watchConversationRecovery(page, journey.channelId, consumer);
      await control('refuse-messaging-history', journey.pressureSelectors);
      await page.goto(`/messages/${journey.channelId}`);
      const deadline = recoveryDeadline();
      await effectsRan(page);
      const initial = await settledRefusal(page, deadline);
      // Controlled transport of the real authorized response, as in the held proof.
      // No status/body is synthesized and every automatic read runs exactly once.
      await page.route(`**/messages/${journey.channelId}?*`, async (route) => {
        if (
          route.request().method() !== 'GET' ||
          !isMessagingRefetch(route.request().headers())
        )
          return route.continue();
        const budget = deadline - Date.parse(systemClock.now());
        if (budget <= 0)
          throw new Error(
            'Controlled recovery delivery exceeded its existing10s budget',
          );
        await boundedStep(
          'the actual controlled refusal delivery',
          async () => {
            const { response } = await readControlledRefusal(
              route,
              info,
              budget,
            );
            observer!.includeResponse(response.headers()['x-request-id']);
            await route.fulfill({ response });
          },
          budget,
        );
      });
      await driveRefusalDeadlines(page, observer, initial, deadline);
      await page.clock.fastForward(12000);
      expect(observer.snapshot()).toMatchObject({
        dispatches: 3,
        maximumPending: 1,
        pending: 0,
      });
      await expect(composer(page)).toHaveCount(0);
      expect(observer.requestBoundary().requestIds.length).toBe(4);
      const completed = await awaitMessagingOperations(
        readMessagingAdmissionLog,
        {
          ...observer.requestBoundary(),
          operation: 'messaging.history',
        },
      );
      expect(
        completed.every(
          (record) =>
            record.status === 503 &&
            record.errorCode === 'INFRASTRUCTURE' &&
            record.admission === 'social.expired',
        ),
      ).toBe(true);
      await evidence(info, observer);
    } finally {
      try {
        await control('allow-messaging-reads');
      } finally {
        observer?.stop();
        await journey.close();
      }
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
      await control('refuse-messaging-history', journey.pressureSelectors);
      await page.goto(`/messages/${journey.channelId}`);
      await expect(refused(page)).toBeVisible();
      await control('allow-messaging-reads');
      await page.getByRole('link', { name: 'Try again', exact: true }).click();
      await expect(composer(page)).toBeVisible();
      expect(observer.snapshot().dispatches).toBe(0);
      await evidence(info, observer);
    } finally {
      try {
        await control('allow-messaging-reads');
      } finally {
        observer?.stop();
        await journey.close();
      }
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
      await pauseMessagingRecovery(page);
      const held = Promise.withResolvers<boolean>();
      const gate = Promise.withResolvers<void>();
      release = gate.resolve;
      let captured = false;
      let deliveryDeadline: number | null = null;
      await page.route(`**/messages/${journey.channelId}?*`, async (route) => {
        if (
          route.request().method() !== 'GET' ||
          !isMessagingRefetch(route.request().headers())
        )
          return route.continue();
        const first = !captured;
        captured = true;
        const budget =
          deliveryDeadline === null
            ? STEP_LIMIT_MS
            : deliveryDeadline - Date.parse(systemClock.now());
        const { response, advice } = await readControlledRefusal(
          route,
          info,
          budget,
        );
        observer!.includeResponse(response.headers()['x-request-id']);
        if (first) {
          held.resolve(advice !== null);
          await gate.promise;
        }
        if (deliveryDeadline === null) return route.abort();
        const remaining = deliveryDeadline - Date.parse(systemClock.now());
        if (remaining <= 0)
          throw new Error(
            'Held recovery delivery exceeded its existing10s budget',
          );
        await boundedStep(
          'the controlled refusal delivery after release',
          () => route.fulfill({ response }),
          remaining,
        );
      });
      observer = watchConversationRecovery(page, journey.channelId);
      await control('refuse-messaging-history', journey.pressureSelectors);
      await page.goto(`/messages/${journey.channelId}`);
      await expect(refused(page)).toBeVisible();
      await effectsRan(page);
      await settledRefusal(page, recoveryDeadline());
      await page.clock.fastForward(1000);
      expect(
        await boundedStep(
          'the held real recovery response',
          () => held.promise,
        ),
      ).toBe(true);
      expect(observer.requestBoundary().requestIds.length).toBe(2);
      const refusals = await awaitMessagingOperations(
        readMessagingAdmissionLog,
        {
          ...observer.requestBoundary(),
          operation: 'messaging.history',
        },
      );
      expect(refusals.length).toBe(2);
      expect(
        refusals.every(
          (failure) =>
            failure.status === 503 &&
            failure.errorCode === 'INFRASTRUCTURE' &&
            failure.admission === 'social.expired',
        ),
      ).toBe(true);
      await info.attach('held-recovery-advised', {
        contentType: 'application/json',
        body: JSON.stringify({
          heldTemporaryRender: true,
          genuineHistoryRefusals: 2,
        }),
      });
      // Wait for this exact node in HostRoot.current, never an alternate or old document.
      await expect.poll(() => refusalRenderId(page)).not.toBeNull();
      const before = await refusalRenderId(page);
      expect(before).not.toBeNull();
      observer.phase('unrelated shell action while recovery is held');
      await page.getByRole('button', { name: 'Minimize', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Expand', exact: true }),
      ).toBeVisible();
      await expect
        .poll(async () => {
          const current = await refusalRenderId(page);
          return current !== null && current !== before;
        })
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
      const deadline = recoveryDeadline();
      deliveryDeadline = deadline;
      release();
      const settled = await settledRefusalResponse(
        page,
        observer,
        1,
        before!,
        deadline,
      );
      await driveRefusalDeadlines(page, observer, settled, deadline, 1);
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
      try {
        await control('allow-messaging-reads');
      } finally {
        observer?.stop();
        await journey.close();
      }
    }
  });
}
