# 0051: area hues

Status: accepted (owner request, 2026-10-03). Extends
[ADR 0045](0045-daisy-brand-system.md), which stays the authority for the
palette's forest, sage, cream and butter, and for how tokens are written.

## Context

The palette is forest and cream: surfaces, borders, text and the accent are
all tints of one green. That is the brand, but in the product it made whole
screens read as one colour. The Play screen was the clearest case: five
different ways to play, drawn as five identical green cards, with nothing but
the title to tell them apart. Only gold (honours), the live red, the online
green and the diamond blue stood outside the green.

## Decision

1. **Four area hues** join the palette, each a muted, earthy colour chosen to
   sit with forest and cream rather than against it: `--hue-clay`,
   `--hue-sky`, `--hue-teal` and `--hue-plum`, each with a soft tint
   (`--hue-*-soft`) for chips and icon backgrounds. Colour classes follow
   ADR 0028: `text-hue-clay`, `bg-hue-clay-soft`, and so on.
2. **They tell areas apart; they carry no meaning alone.** Clay is
   competition, sky practice, teal rooms, and plum the two seats that are
   not a debater's: bots and judging, and a name or label
   always accompanies the colour. Gold keeps honours and events
   (ADR 0045), the live red keeps "live", and the accent stays the one
   interactive green. A hue is never used for status or for a primary
   button.
3. **Use is structural**: a solid icon disc, a faint tinted surface, a hover
   border. Text stays ink; a hue is not set as body text colour.
4. **Contrast** is declared in `palette-contrast.test.ts` like every other
   pairing, in both schemes at 4.5:1: each hue's ink on the page's cards,
   on its own tint over a card, and the page background as the icon colour
   on a solid hue disc.

## Consequences

- Adding a fifth hue is another token pair plus a contrast row, and an
  amendment to this record.
- The first uses are the Play options. Other screens adopt hues one at a time
  against the same rules.
