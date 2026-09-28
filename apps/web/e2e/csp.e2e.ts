import { expect, test } from '@playwright/test';

type Violation = { readonly directive: string; readonly blocked: string };

// A fixed-shape token: real redemption is never exercised here, only that
// the view renders with a style nonce.
const token = 'e2eTokenNotARealCredential0123456789';

test('the confirm page style nonce equals the response CSP header nonce (AUTH-4.7)', async ({
  request,
}) => {
  const response = await request.get(`/auth/confirm?token=${token}`);
  const policy = response.headers()['content-security-policy'] ?? '';
  const headerNonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  const html = await response.text();
  const styleNonce = /<style nonce="([^"]+)">/.exec(html)?.[1];
  expect(headerNonce).toBeTruthy();
  expect(styleNonce).toBe(headerNonce);
});

test('the dashboard renders under the production CSP without violations', async ({
  page,
}) => {
  const consoleViolations: string[] = [];
  page.on('console', (message) => {
    if (/content security policy|refused to/i.test(message.text()))
      consoleViolations.push(message.text());
  });
  // Registered before any document script so no early violation is missed.
  await page.addInitScript(() => {
    const seen: Violation[] = [];
    Reflect.set(window, '__cspViolations', seen);
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
      });
    });
  });

  await page.goto('/');
  const hero = page.getByRole('img', {
    name: 'A green mountain ridge at dawn with rolling fog',
  });
  await expect(hero).toBeVisible();

  // `next/image` with `fill` sizes itself through an inline style attribute;
  // if the policy refuses it the image drops out of its absolute geometry.
  const geometry = await hero.evaluate((image) => {
    const parent = image.parentElement;
    if (!parent) throw new Error('hero image has no parent');
    const box = image.getBoundingClientRect();
    // An absolute fill covers the parent's padding box (inside its border).
    return {
      position: getComputedStyle(image).position,
      widthDelta: Math.abs(box.width - parent.clientWidth),
      heightDelta: Math.abs(box.height - parent.clientHeight),
      area: box.width * box.height,
    };
  });
  const eventViolations = await page.evaluate(
    () => Reflect.get(window, '__cspViolations') as Violation[],
  );

  expect({ eventViolations, consoleViolations }).toEqual({
    eventViolations: [],
    consoleViolations: [],
  });
  expect(geometry.position).toBe('absolute');
  expect(geometry.area).toBeGreaterThan(0);
  expect(geometry.widthDelta).toBeLessThanOrEqual(1);
  expect(geometry.heightDelta).toBeLessThanOrEqual(1);
});
