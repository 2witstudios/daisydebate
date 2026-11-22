import type { Page } from '@playwright/test';
import { origin } from './accounts';
import { expect } from './fixtures';
import { hydrated } from './hydration';

/** The saved shell preference applies on Prep as it does on Home. */
export async function assertPrepSidebar(
  page: Page,
  viewport: { readonly width: number; readonly height: number },
) {
  if (viewport.width >= 901) {
    const main = await page.getByRole('main').boundingBox();
    const files = await page
      .getByRole('region', { name: 'Your files' })
      .boundingBox();
    expect(files).toEqual(main);
    const rail = page.getByRole('navigation', { name: 'Primary' });
    const column = await rail.evaluate((nav) => {
      // The shell grid child owns the footprint, including its divider.
      const outer = nav.parentElement!;
      const bounds = outer.getBoundingClientRect();
      const style = getComputedStyle(outer);
      return {
        width: bounds.width,
        top: bounds.top,
        bottom: bounds.bottom,
        borderWidth: style.borderRightWidth,
        borderStyle: style.borderRightStyle,
      };
    });
    expect(column).toEqual({
      width: viewport.width >= 1101 ? 184 : 56,
      top: 0,
      bottom: viewport.height,
      borderWidth: '1px',
      borderStyle: 'solid',
    });
    const prep = rail.getByRole('link', { name: 'Prep', exact: true });
    await expect(prep).toBeVisible();
    const prepTarget = await prep.boundingBox();
    expect(prepTarget?.width).toBeGreaterThanOrEqual(44);
    expect(prepTarget?.height).toBe(44);
    if (viewport.width >= 1101) {
      const minimize = rail.getByRole('button', { name: 'Minimize' });
      const expand = rail.getByRole('button', { name: 'Expand' });
      await hydrated(minimize);
      await minimize.click();
      await expect(expand).toBeVisible();
      await rail.getByRole('link', { name: 'Home', exact: true }).click();
      await expect(page).toHaveURL(`${origin}/`);
      await expect(expand).toBeVisible();
      await prep.click();
      await expect(page).toHaveURL(`${origin}/prep`);
      await expect(expand).toBeVisible();
      await expand.click();
      await expect(minimize).toBeVisible();
    }
  }
}
