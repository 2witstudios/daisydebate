# 0045: Daisy brand system

Status: accepted (owner decisions, 2026-09-27, Plan — Brand system; BRAND-1.1).
Builds on [ADR 0027](0027-theme-preference.md) (theme) and
[ADR 0028](0028-tailwind-v4.md) (token lock), which stays the authority for
how tokens are written and used. The usage guide is
[docs/development/brand.md](../development/brand.md).

## Context

Daisy had no real logo. The mark was eight plain ellipses around a disc,
and the palette was a bright "Daisy green" (`#157c3e` / `#3ecf7a`) that did
not match the brand inspiration board. The board defines a whole system: an
eight-petal bloom of forest and sage petals around a yolk disc, a
monochrome icon, a forest favicon tile, a heavy-serif "Daisy / DEBATE"
wordmark, the petal primitive and a pair of opposing petals, a petal
lattice, cropped-bloom art, a bracket that resolves into a bloom, pill
chips, and ranked banners. This record fixes the parts every later brand
leaf builds on.

## Decision

### 1. Palette

Tokens stay in `apps/web/src/app/globals.css`, each written once with
`light-dark()` (ADR 0027, ADR 0028). Dark stays the default scheme.

**Brand primitives** have colour utilities (`fill-forest`, `bg-cream`, …).
Light keeps the board values; dark lifts the two darkest so they still
read on the forest-black page.

| Token         | Light     | Dark      | Role                                          |
| ------------- | --------- | --------- | --------------------------------------------- |
| `--forest`    | `#173b2a` | `#4a8a64` | Mark cardinals, the stage, primary ink        |
| `--sage`      | `#a7c09c` | `#a7c09c` | Mark diagonals, the dark accent               |
| `--sage-deep` | `#7e9c79` | `#8fae89` | Deeper petals in graphics and patterns        |
| `--cream`     | `#f5f0e4` | `#f5f0e4` | The light page, reverse petals, dark ink      |
| `--butter`    | `#f7da8c` | `#f7da8c` | The email's brand dot; honours lean toward it |
| `--yolk`      | `#f2c14e` | `#f2c14e` | The mark's disc                               |

**Semantic tokens** are retuned from the primitives:

- Light reads as the board's cream: background `#f5f0e4`, surfaces stepping
  toward `#fffdf8`, warm sage-grey borders, forest text, and a forest
  accent with cream accent ink.
- Dark reads as forest: background `#0d1812`, surfaces stepping up through
  forest tones, cream text, and a sage accent with forest accent ink, as on
  the board's "Find a Match" button.
- `--surface-emerald` is renamed `--surface-stage` at every call site with
  no alias (ADR 0023). The stage is a forest panel (`#173b2a`) in both
  schemes. Because it never changes, it carries its own ink:
  `--stage-text` (cream), `--stage-text-muted`, and a sage
  `--stage-accent` / `--stage-accent-strong` button with forest
  `--stage-accent-text`. Stage content uses `text-stage-ink` and the
  `stage-accent` classes, never the page's `text-ink` or `bg-accent`:
  in light those are forest on forest. The render tests of each stage
  surface (the auth panel and its step bodies, the featured tournament)
  fail on any page-palette colour class.
- `--gold` becomes brass in light (`#7e5c12`) and butter in dark
  (`#f0cf7a`), for honours. `--live`, `--online` and `--tier-diamond` are
  retuned for contrast on the new surfaces.
- The browser chrome colours in `ui/theme/theme-preference.ts` mirror the
  `--background` pair, pinned by a test.

**Contrast.** `apps/web/src/app/palette-contrast.test.ts` resolves every
declared text-on-surface and UI pairing in both schemes and requires WCAG
AA: 4.5:1 for text and 3:1 for UI (focus ring, glyphs, dots, the stage
button, and the mark's forest petals on the page). A new pairing in markup
is declared there. The mark itself is decorative: sage on cream is below
3:1 by design, and the mark never carries meaning alone.

### 2. The petal primitive

One pure function draws every petal: `petalPath(shape, placement)` in
`apps/web/src/ui/brand/petal.ts`. The petal is a teardrop of four cubic
Béziers. Each side runs from the tip to the widest point, then a
quarter-ellipse closes the rounded outer bulb. Four parameters shape it:

- **length**: tip to outer end;
- **width**: across the bulb;
- **bulb**: where the petal is widest, as a fraction of the length from the
  tip;
- **tip sharpness**: how the sides leave the tip. At 0 they leave square to
  the axis (a round tip); at 1 they aim straight at the bulb's handle, the
  sharpest point whose outline stays convex. Each side's control polygon
  stays convex, so the outline never bends inward; `petal.test.ts` checks
  the curvature over the brand sheet's whole range.

The placement puts the tip at a point, turns the petal clockwise from
upright, and scales it about the tip. `bloom(count = 8)` returns the
petal rotations; `opposingPetals` places two petals tip to tip, each the
other turned half a circle.

Every tunable number lives in **one constants module**,
`apps/web/src/ui/brand/brand-geometry.ts`, and every brand renderer reads it.
The committed values are length 8.4, width 4.1, bulb 0.58 and tip
sharpness 0.2, in a 24-unit drawing. The disc radius is 2.6 and the petal
tips sit 2.7 from the centre, so a ring of the surface shows between the
disc and the petals' rounded inner ends. A first tuning (length 9.4, bulb
0.66, sharpness 0.95, tips under the disc) pinched every petal to a point
at the centre and read as a pinwheel at the auth panel's 520px, so the
petals keep the round inner ends of the original ellipse mark with a
fuller outer bulb, slim enough that the gaps between petals still show at
the 34px logo. The `/foundation` brand sheet previews other values
with sliders, but what ships is the module. The sliders' ranges keep every
preview inside its drawing: the longest petal is half the drawing less the
petal inset.

### 3. Mark variants

`DaisyMark` (`apps/web/src/ui/components/daisy-mark/`) takes a required
`variant`:

- **primary**: cardinal petals (N, E, S, W), diagonal petals and a yolk
  disc, on the page background in either scheme. The petals take the
  `--mark-cardinal` and `--mark-diagonal` tokens: forest and sage on the
  cream page, cream on the dark page (a lifted forest sank into the
  background there and read as an icon, not a logo).
- **mono**: every petal and the disc in `currentColor`. The ring between
  the disc and the petals is part of the geometry, so no mask is needed.
  Use it for one-colour contexts: print and embossing.
- **reverse**: cream petals and a yolk disc, for forest surfaces (the
  stage).

`DaisyTile` is the favicon tile: a forest (`surface-stage`) rounded square,
corner radius 5.5 of 24, holding a reverse bloom at 0.8 scale.
`OpposingPetals` is the debate's two sides: a forest petal and a sage
petal, tip to tip, in a 2:1 box. All three are `aria-hidden`. A mark that
names something gets its accessible name from the link or text beside it.

### 4. Wordmark and lockups

BRAND-2.1 builds these lockups. The rules are fixed here.

- **The name**: the company and product are "Daisy Debate". Every surface
  a person sees (wordmarks, page titles, emails, the passkey name) says
  "Daisy Debate", never "Daisy" alone. Until BRAND-2.1's lockups land, the
  interim wordmark beside the mark is "Daisy Debate" on one line.

- **"Daisy"**: Fraunces at black or heavy weight, SOFT 0, WONK off, high
  optical size. It is live text.
- **"DEBATE"**: Instrument Sans capitals, tracked with a `--tracking-brand`
  token (about 0.32em), set under "Daisy" and spanning its width.
- **Lockups**: horizontal (the mark beside the stacked words, the mark as
  tall as the two lines), stacked (the mark centred above the words), and
  wordmark-only.
- **Clear space**: keep a quarter of the mark's height clear on every side
  of the mark or lockup. In a lockup, the gap between mark and words is
  also a quarter of the mark's height.
- **Minimum sizes**:
  - primary mark: 24px (below that, use the tile or mono);
  - mono mark and the tile: 16px;
  - horizontal lockup: 24px mark;
  - stacked lockup: 48px mark;
  - wordmark-only: "Daisy Debate" at 20px.

### 5. Graphic usage

- The **petal lattice**, **cropped bloom**, **pill chips**, **bracket**
  and **leaderboard rows** come later (BRAND-3.x). Each draws from
  `petalPath` and the primitives, never a hand-copied path or hex value.
- Brand graphics are decoration: they are `aria-hidden` and never the
  only carrier of meaning.
- The brand is generated in code: parametric TypeScript produces SVG,
  React renders it, and Next's `ImageResponse` rasterises the icons.
- Where each graphic may appear is in the usage guide.

### 6. Brand sheet previews

The `/foundation` brand sheet shows every variant in both schemes side by
side, so the owner can sign it off (BRAND-1.4). It stays gated exactly as
the foundation proof is. To show both schemes at once, two utilities in
`apps/web/src/app/theme/brand.css`, `preview-scheme-light` and
`preview-scheme-dark`, pin `color-scheme` on a preview panel. Every token
still resolves through `light-dark()`. This is the one exception to
`<html data-theme>` owning color-scheme, and `brand-sheet.test.tsx` fails
if either class appears anywhere outside the brand sheet (DEC-32).

## Consequences

- The bright Daisy green and the ellipse mark are gone. No alias, legacy
  variant or compatibility token remains (ADR 0023).
- Every mark's disc is `--yolk` (`#f2c14e`), deeper than butter so the
  centre reads against cream petals at logo size; butter stays for the
  email's brand dot.
- `DaisyLogo` stays, as the primary mark with no tile beside the wordmark,
  until BRAND-2.1 replaces it with the lockups. The confirm pages draw the
  same logo from `bloomPetals`.
- Each later brand leaf is built from the geometry module and the
  primitives, not from new numbers.
- Pages that the Next stylesheet never reaches (the AUTH-4.7 confirm pages
  and the auth email) read the palette as static values from
  `apps/web/src/features/auth/brand-palette.ts`, which a test pins to
  `globals.css`, stage tokens included. The confirm pages draw both marks
  from `bloomPetals`, and their panel is the forest stage with its own ink.
  The mark tokens are in the palette too.
  BRAND-2.3 still owns the email's mark and wordmark.
- A palette change that drops any declared pairing below AA fails
  `bun check`.
