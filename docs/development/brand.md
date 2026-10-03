# Brand usage

How to use the Daisy brand in `apps/web`. The decisions behind it (palette
values, petal geometry, variants, lockups, clear space and minimum sizes)
are in [ADR 0045](../decisions/0045-daisy-brand-system.md), and the token
rules are in [ADR 0028](../decisions/0028-tailwind-v4.md). To preview a
change, open the brand sheet on `/foundation` with
`FOUNDATION_PROOF_ENABLED=true`.

## Where the pieces live

- Geometry: `apps/web/src/ui/brand/`. `petal.ts` holds the pure
  `petalPath`, `bloom` and `opposingPetals`, and `brand-geometry.ts` holds
  every tunable number. Change a number only there, and check it on the
  brand sheet in both schemes.
- Marks: `apps/web/src/ui/components/daisy-mark/`, which holds `DaisyMark`
  (`primary`, `mono`, `reverse`), `DaisyTile`, `OpposingPetals` and, until
  BRAND-2.1, `DaisyLogo`.
- Colour: the brand primitives (`forest`, `sage`, `sage-deep`, `cream`,
  `butter`, and `yolk` for the mark's disc) and the semantic tokens in `apps/web/src/app/globals.css`.

## Which mark on which surface

| Surface                                      | Use                                                          |
| -------------------------------------------- | ------------------------------------------------------------ |
| The page background or a card, either scheme | `primary`                                                    |
| The stage (`bg-surface-stage`) or any forest | `reverse`                                                    |
| One-colour contexts: print, foil             | `mono`, coloured by the text colour around it                |
| Browser tab, app icon, 16–32px               | `DaisyTile`                                                  |
| Anything about the two sides of a debate     | `OpposingPetals`                                             |
| Below 24px                                   | `mono` or `DaisyTile`; the primary colours blur at that size |

- Do not recolour a variant with classes, and do not rotate, stretch or
  outline a mark.
- Do not set a mark on a photograph without the scrim.
- Keep a quarter of the mark's height clear on every side.

## Stage surfaces

The stage is forest in both schemes. Content on it uses the stage's own
ink (`text-stage-ink`, `text-stage-ink-muted`) and button
(`bg-stage-accent`, `hover:bg-stage-accent-strong`,
`text-stage-accent-ink`), never the page's `text-ink` or `bg-accent`: in
light those are forest, and they would disappear on the stage. Stage
moments today are the featured tournament and the auth panel, including
the step bodies passed into it (the check-inbox steps, the saved-passkey
facts). Each one's render test runs `pageColourClasses`
(`apps/web/src/ui/test-support/stage-palette.ts`) and fails on any
page-palette colour class; add the same assertion to any new stage
surface. The AUTH-4.7 confirm pages are rendered outside React, so their
stylesheet test checks the same thing: the panel uses `--af-stage-ink`.

## Brand graphics

Each graphic draws from `petalPath` and the primitives. None may use a
hand-copied path or hex value. All of them are decoration: `aria-hidden`,
and never the only carrier of meaning.

- **Petal pattern** (lattice): only as a background texture: behind a
  hero, a stage panel, or an empty state. Never behind body text without a
  solid surface in between, and never in dense lists or forms.
- **Cropped bloom**: oversized bloom art anchored to a corner, on hero
  banners and the auth panel (it replaces the auth watermark and the
  dashboard hero photograph). Use one per view, cropped by the container,
  and never under a control.
- **Chip**: a pill with an icon and a sentence-case label (Ranked,
  Tournament, Champion, Top 100) for categories and honours. The existing
  `Badge` stays for tiny uppercase status. A chip is not a button unless it
  is inside one.
- **Bracket**: petal nodes joined by connector lines, resolving into a
  bloom for the winner. Use it only for tournament structure.
- **Leaderboard rows**: rank, a bloom marker, name and rating, on ranked
  panels and leaderboards.

## Area hues

Four muted secondary colours let areas tell themselves apart on a screen
that would otherwise be all green ([ADR 0051](../decisions/0051-area-hues.md)):
clay (competition), sky (practice), teal (rooms) and plum (bots and judging), each with a
`-soft` tint. Use them for an icon chip, a tinted surface or a hover border,
never for body text, status or a primary button, and always beside a label.
Gold stays for honours and events, and the live red for "live".

## Contrast

Every text and UI pairing you add in markup (a new `text-*` on a new
`bg-*`) is declared in `apps/web/src/app/palette-contrast.test.ts`. The test
holds each pair to WCAG AA in both schemes: 4.5:1 for text and 3:1 for UI.
The marks are exempt as decoration, but the forest petals are still held
to 3:1 on the page.
