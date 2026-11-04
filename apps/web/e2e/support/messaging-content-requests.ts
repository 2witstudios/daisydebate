import {
  createMessagingCoreSchemas,
  messagingBetaLimits,
} from '@daisy/protocol';
import type { BrowserContext } from '@playwright/test';
import type { openMessagingJourney } from './messaging-journey';
import { createId } from '@paralleldrive/cuid2';
import { expect } from './fixtures';

export type MessagingJourney = Awaited<ReturnType<typeof openMessagingJourney>>;

/** Populate history through the real authorized message operation. */
export const postMessage = async (
  from: BrowserContext,
  journey: Pick<MessagingJourney, 'channelId'>,
  origin: string,
  text: string,
) => {
  const response = await from.request.post('/api/messaging/messages', {
    headers: { origin },
    data: {
      version: 1,
      channelId: journey.channelId,
      requestId: createId(),
      text,
    },
  });
  expect(response.status()).toBe(200);
  return createMessagingCoreSchemas(messagingBetaLimits).message.parse(
    await response.json(),
  );
};
