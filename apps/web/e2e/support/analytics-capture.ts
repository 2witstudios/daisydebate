import type { BrowserContext } from '@playwright/test';
import { expect } from './fixtures';

type AnalyticsEnvelope = {
  event: string;
  properties: Record<string, unknown>;
  $set?: unknown;
  $set_once?: unknown;
};

export function expectAnalyticsPrivacy(captures: readonly AnalyticsEnvelope[]) {
  expect(JSON.stringify(captures)).not.toContain('private@example.test');
  for (const event of captures) {
    expect(event).not.toHaveProperty('$set');
    expect(event).not.toHaveProperty('$set_once');
    expect(event.properties.token).toBe('phc_browser_fixture');
  }
}

/** Vendor transport terminates locally. Synthetic credentials never reach PostHog. */
export async function captureAnalytics(context: BrowserContext) {
  const captures: AnalyticsEnvelope[] = [];
  const requests: string[] = [];
  // PostHog intentionally filters automation; emulate ordinary visitor
  // capabilities while keeping the actual production SDK/transport.
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => false,
    });
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => ({
        brands: [{ brand: 'Chromium', version: '145' }],
        mobile: false,
        platform: 'macOS',
      }),
    });
  });
  await context.route('https://*.posthog.com/**', async (route) => {
    const request = route.request();
    requests.push(request.url());
    const raw = request.postData();
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      const events = Array.isArray(parsed)
        ? parsed
        : ((parsed as { batch?: unknown[] }).batch ?? [parsed]);
      captures.push(...(events as AnalyticsEnvelope[]));
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });
  return { captures, requests };
}
