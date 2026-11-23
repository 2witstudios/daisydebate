import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { markGeometry, petalShape } from '../features/brand/brand-geometry';
import { petalPath, type PetalShape } from '../features/brand/petal';
import { renderMarkup } from '../test-support/rendered/markup';
import {
  BrandSheet,
  BrandSheetView,
} from '../app/(bare)/foundation/brand-sheet';

setupRitewayBun();

/**
 * The brand sheet's marks are decorative SVG (aria-hidden), so what they
 * draw has no accessible equivalent: the scheme-pinning utilities (ADR
 * 0045), the fill classes, the favicon tile's pixel size and the petal
 * geometry are read from the markup itself.
 */
const upright = (shape: PetalShape) =>
  petalPath(shape, {
    tip: [markGeometry.centre, markGeometry.centre - markGeometry.petalInset],
    angle: 0,
  });

const count = (html: string, pattern: RegExp) =>
  html.match(new RegExp(pattern, 'g'))?.length ?? 0;

describe('BrandSheet markup', () => {
  test('shows every mark variant, the tile at favicon size and the petal pair in both schemes', () => {
    const html = renderMarkup(h(BrandSheet));
    assert({
      given: 'the brand sheet as first served',
      should:
        'render a light and a dark panel, each with primary, mono and reverse marks, a 16px tile and the opposing petals',
      actual: {
        panels: [
          count(html, /preview-scheme-light/),
          count(html, /preview-scheme-dark/),
        ],
        primary: count(html, /class="fill-yolk"/),
        mono: count(html, /class="fill-current"/),
        faviconTiles: count(html, /<svg[^>]*width="16"[^>]*height="16"/),
        pairs: count(html, /viewBox="0 0 48 24"/),
      },
      expected: {
        panels: [1, 1],
        // Per panel: the primary and reverse discs plus two tiles' discs.
        primary: 8,
        // Per panel: the mono mark's eight petals and its disc.
        mono: 18,
        faviconTiles: 2,
        pairs: 2,
      },
    });
  });

  test('previews the committed constants by default', () => {
    const html = renderMarkup(h(BrandSheet));
    assert({
      given: 'the sheet with no slider moved',
      should: 'draw the shipped petal',
      actual: html.includes(`d="${upright(petalShape)}"`),
      expected: true,
    });
  });
});

describe('BrandSheetView markup', () => {
  const tuned: PetalShape = { ...petalShape, width: 4 };

  test('draws the shape it is given', () => {
    const html = renderMarkup(
      h(BrandSheetView, { shape: tuned, onTune: () => {}, onReset: () => {} }),
    );
    assert({
      given: 'a tuned width',
      should: 'draw the tuned petal and not the shipped one',
      actual: [
        html.includes(`d="${upright(tuned)}"`),
        html.includes(`d="${upright(petalShape)}"`),
      ],
      expected: [true, false],
    });
  });
});
