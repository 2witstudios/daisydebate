import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ChangeEvent } from 'react';
import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { markGeometry, petalShape } from '../../../ui/brand/brand-geometry';
import { petalPath, type PetalShape } from '../../../ui/brand/petal';
import { findElements } from '../../../ui/test-support/find-elements';
import { BrandSheet, BrandSheetView } from './brand-sheet';

setupRitewayBun();

const upright = (shape: PetalShape) =>
  petalPath(shape, {
    tip: [markGeometry.centre, markGeometry.centre - markGeometry.petalInset],
    angle: 0,
  });

const count = (html: string, pattern: RegExp) =>
  html.match(new RegExp(pattern, 'g'))?.length ?? 0;

describe('BrandSheet', () => {
  test('shows every mark variant, the tile at favicon size and the petal pair in both schemes', () => {
    const html = renderToString(h(BrandSheet));
    assert({
      given: 'the brand sheet as first served',
      should:
        'render a light and a dark panel, each with primary, mono and reverse marks, a 16px tile and the opposing petals',
      actual: {
        panels: [
          count(html, /preview-scheme-light/),
          count(html, /preview-scheme-dark/),
        ],
        primary: count(html, /class="fill-butter"/),
        mono: count(html, /<mask /),
        faviconTiles: count(html, /<svg[^>]*width="16"[^>]*height="16"/),
        pairs: count(html, /viewBox="0 0 48 24"/),
      },
      expected: {
        panels: [1, 1],
        // Per panel: the primary and reverse discs plus two tiles' discs.
        primary: 8,
        mono: 2,
        faviconTiles: 2,
        pairs: 2,
      },
    });
  });

  test('previews the committed constants by default', () => {
    const html = renderToString(h(BrandSheet));
    assert({
      given: 'the sheet with no slider moved',
      should: 'draw the shipped petal and set each slider to its value',
      actual: [
        html.includes(`d="${upright(petalShape)}"`),
        html.includes(`value="${petalShape.length}"`),
        html.includes(`value="${petalShape.tipSharpness}"`),
      ],
      expected: [true, true, true],
    });
  });
});

describe('BrandSheetView', () => {
  const tuned: PetalShape = { ...petalShape, width: 4 };

  test('draws the shape it is given', () => {
    const html = renderToString(
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

  test('reports each slider move as a tuning of its parameter', () => {
    const tunes: string[] = [];
    const tree = BrandSheetView({
      shape: petalShape,
      onTune: (key, raw) => tunes.push(`${key}=${raw}`),
      onReset: () => {},
    });
    const sliders = findElements(
      tree,
      (element) => element.props.type === 'range',
    );
    for (const slider of sliders)
      (slider.props.onChange as (event: ChangeEvent<HTMLInputElement>) => void)(
        {
          currentTarget: { value: '0.5' },
        } as ChangeEvent<HTMLInputElement>,
      );
    assert({
      given: 'each of the four sliders moved',
      should: 'report the parameter it tunes with the raw value',
      actual: tunes,
      expected: ['length=0.5', 'width=0.5', 'bulb=0.5', 'tipSharpness=0.5'],
    });
  });
});

describe('preview-scheme utilities', () => {
  const sourceRoot = join(import.meta.dir, '../../..');
  const sources = (dir: string): readonly string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? sources(join(dir, entry.name))
        : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
          ? [join(dir, entry.name)]
          : [],
    );

  test('are used only by the brand sheet', () => {
    assert({
      given: 'every source file in the web app',
      should:
        'find the classes that pin a colour scheme only under /foundation (ADR 0045)',
      actual: sources(sourceRoot)
        .filter((file) =>
          readFileSync(file, 'utf8').includes('preview-scheme-'),
        )
        .map((file) => relative(sourceRoot, file)),
      expected: ['app/(bare)/foundation/brand-sheet.tsx'],
    });
  });
});
