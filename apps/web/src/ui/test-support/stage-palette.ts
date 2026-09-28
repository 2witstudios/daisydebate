/**
 * Test support: the page-palette colour classes in rendered markup. The
 * stage is forest in both schemes, so in light the page's `text-ink`,
 * `text-accent` or `border-border` draw forest on forest there; stage
 * content takes the stage tokens instead (ADR 0045).
 */
const pageColour =
  /^(?:[a-z-]+:)*(?:text|bg|border|fill|stroke|from|via|to|ring|outline|decoration)-(?:ink|ink-muted|ink-faint|accent|accent-strong|accent-soft|accent-ink|glyph|background|surface|surface-raised|surface-overlay|surface-sunken|border|border-strong)(?:\/\d+)?$/;

export const pageColourClasses = (html: string): readonly string[] =>
  [...html.matchAll(/class="([^"]*)"/g)]
    .flatMap(([, list]) => (list ?? '').split(/\s+/))
    .filter((name) => pageColour.test(name));
