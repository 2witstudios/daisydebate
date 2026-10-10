import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import './realtime-fixture';

/** Mount a second actual consumer, then remove only the original consumer. */
export async function retainSecondRealtimeConsumer(page: Page, topic: string) {
  await page.evaluate((topic) => {
    const proof = window.realtimeProof;
    const second = proof.store.subscribeTopic(topic, (frame) =>
      proof.frames.push(frame),
    );
    proof.release();
    proof.release = second;
  }, topic);
  expect(
    await page.evaluate(
      () =>
        window.realtimeProof.transportFrames.filter(
          (frame) => frame.type === 'unsubscribed',
        ).length,
    ),
  ).toBe(0);
}

/** The final consumer releases the actual native subscription, keeping the socket. */
export async function releaseLastRealtimeConsumer(page: Page) {
  await page.evaluate(() => window.realtimeProof.release());
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.realtimeProof.transportFrames.filter(
            (frame) => frame.type === 'unsubscribed',
          ).length,
      ),
    )
    .toBe(1);
  expect(
    await page.evaluate(() => window.realtimeProof.store.getState().status),
  ).toBe('open');
}
