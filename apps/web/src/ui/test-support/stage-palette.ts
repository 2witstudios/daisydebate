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

const stageColour =
  /^(?:[a-z-]+:)*(?:text|bg|border|fill|stroke|from|via|to|ring|outline|decoration)-(?:surface-stage|stage-ink|stage-ink-muted|stage-accent|stage-accent-strong)(?:\/\d+)?$/;

/**
 * The stage colour classes in rendered markup: the stage's cream ink and
 * sage accent read cream on cream in light, so page content never takes
 * them. `stage-accent-ink` is forest in both schemes, the ink for light
 * chips such as yolk, so it is not one of them.
 */
export const stageColourClasses = (html: string): readonly string[] =>
  [...html.matchAll(/class="([^"]*)"/g)]
    .flatMap(([, list]) => (list ?? '').split(/\s+/))
    .filter((name) => stageColour.test(name));

/** The stage colour classes in an auth frame's brand panel. */
export const panelStageColours = (page: string): readonly string[] =>
  stageColourClasses(page.slice(page.indexOf('<aside')));
