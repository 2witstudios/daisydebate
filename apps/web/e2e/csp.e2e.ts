import { expect, test } from '@playwright/test';
import { watchCspViolations } from './support/csp';

test('the dashboard renders under the production CSP without violations', async ({
  page,
}) => {
  const violations = await watchCspViolations(page);

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

  expect(await violations.read()).toEqual({
    eventViolations: [],
    consoleViolations: [],
  });
  expect(geometry.position).toBe('absolute');
  expect(geometry.area).toBeGreaterThan(0);
  expect(geometry.widthDelta).toBeLessThanOrEqual(1);
  expect(geometry.heightDelta).toBeLessThanOrEqual(1);
});
