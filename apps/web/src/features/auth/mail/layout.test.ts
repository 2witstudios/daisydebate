import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { AUTH_BRAND_PALETTE, type BrandPalette } from '../brand-palette';
import { renderAuthEmail } from './templates';

setupRitewayBun();

const rendered = renderAuthEmail({
  kind: 'sign-in',
  url: 'https://daisy.example.com/auth/confirm?token=abc',
}).html;

/** sRGB hex → relative luminance (WCAG 2.x). */
function relativeLuminance(hex: string): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two sRGB hex colors, 1 (none) to 21 (max). */
function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The layout's own foreground/background pairs, mirroring `LIGHT`/`DARK` in
 * layout.ts (mail clients read inline styles only, never a design-system
 * component, so this checks the actual emailed colors, not the app theme).
 */
const pairsFor = (palette: BrandPalette) => ({
  headlineOnSurface: [palette.ink, palette.surfaceRaised] as const,
  mutedOnSurface: [palette.inkMuted, palette.surfaceRaised] as const,
  buttonLabelOnAccent: [palette.accentInk, palette.accentStrong] as const,
});

describe('AUTH-3.9 auth email layout: width, dark mode and contrast (ISSUE-167)', () => {
  test('constrains the surface to a fixed mobile-safe width', () => {
    assert({
      given: 'the rendered layout markup',
      should:
        'set both a fluid 100% width and a 600px cap on the message surface',
      actual: {
        hasFluidWidth: rendered.includes('width="600"'),
        hasMaxWidth: rendered.includes('max-width:600px'),
      },
      expected: { hasFluidWidth: true, hasMaxWidth: true },
    });
  });

  test('declares a dark-mode override for every themed surface class', () => {
    assert({
      given: 'the rendered layout markup',
      should:
        'carry a prefers-color-scheme: dark block that overrides the background, surface, ink, muted, accent and button classes',
      actual: {
        hasDarkMediaQuery: rendered.includes(
          '@media (prefers-color-scheme: dark)',
        ),
        overridesEveryClass: [
          '.auth-mail-bg',
          '.auth-mail-surface',
          '.auth-mail-ink',
          '.auth-mail-muted',
          '.auth-mail-accent',
          '.auth-mail-button',
        ].every((selector) => rendered.includes(selector)),
      },
      expected: { hasDarkMediaQuery: true, overridesEveryClass: true },
    });
  });

  /** Whether every named foreground/background pair meets WCAG AA (4.5:1). */
  const meetsAA = (pairs: Record<string, readonly [string, string]>) =>
    Object.fromEntries(
      Object.entries(pairs).map(([name, [fg, bg]]) => [
        name,
        contrastRatio(fg, bg) >= 4.5,
      ]),
    );

  for (const theme of ['light', 'dark'] as const) {
    test(`every ${theme}-mode text/background pair meets WCAG AA (4.5:1)`, () => {
      const pairs = pairsFor(AUTH_BRAND_PALETTE[theme]);
      const actual = meetsAA(pairs);
      assert({
        given: `the ${theme} palette's headline, muted and button-label pairs`,
        should: 'each reach at least a 4.5:1 contrast ratio',
        actual,
        expected: Object.fromEntries(
          Object.keys(actual).map((name) => [name, true]),
        ),
      });
    });
  }
});
