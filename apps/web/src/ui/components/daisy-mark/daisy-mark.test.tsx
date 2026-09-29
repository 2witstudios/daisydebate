import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { markGeometry, petalShape } from '../../brand/brand-geometry';
import { petalPath } from '../../brand/petal';
import { DaisyLogo, DaisyMark, DaisyTile } from './daisy-mark';

setupRitewayBun();

const petalClasses = (html: string) =>
  [...html.matchAll(/<path d="[^"]+" class="([^"]+)"/g)].map(
    ([, className]) => className,
  );

const discClass = (html: string) =>
  new RegExp(
    `<circle cx="12" cy="12" r="${markGeometry.discRadius}" class="([^"]+)"`,
  ).exec(html)?.[1];

const uprightPetal = petalPath(petalShape, {
  tip: [markGeometry.centre, markGeometry.centre - markGeometry.petalInset],
  angle: 0,
});

describe('DaisyMark', () => {
  test('draws eight teardrop petals from the petal primitive, hidden from assistive tech', () => {
    const html = renderToString(h(DaisyMark, { size: 24, variant: 'primary' }));
    assert({
      given: 'a primary mark',
      should:
        'render eight petal paths, the upright one from petalPath, no ellipse, and aria-hidden',
      actual: [
        petalClasses(html).length,
        html.includes(`d="${uprightPetal}"`),
        html.includes('<ellipse'),
        html.includes('aria-hidden="true"'),
        html.includes('width="24"'),
      ],
      expected: [8, true, false, true, true],
    });
  });

  test('colours the primary mark from the scheme-following petal tokens and yolk', () => {
    const html = renderToString(h(DaisyMark, { size: 24, variant: 'primary' }));
    assert({
      given: 'the primary variant',
      should:
        'alternate cardinal and diagonal petals (forest and sage on cream, cream on the dark page) around a yolk disc',
      actual: [petalClasses(html), discClass(html)],
      expected: [
        [
          'fill-mark-cardinal',
          'fill-mark-diagonal',
          'fill-mark-cardinal',
          'fill-mark-diagonal',
          'fill-mark-cardinal',
          'fill-mark-diagonal',
          'fill-mark-cardinal',
          'fill-mark-diagonal',
        ],
        'fill-yolk',
      ],
    });
  });

  test('draws the mono mark in currentColor, with no mask', () => {
    const html = renderToString(h(DaisyMark, { size: 24, variant: 'mono' }));
    assert({
      given: 'the mono variant',
      should:
        'fill every petal and the disc with currentColor and mask nothing',
      actual: [
        new Set(petalClasses(html)),
        discClass(html),
        html.includes('<mask'),
      ],
      expected: [new Set(['fill-current']), 'fill-current', false],
    });
  });

  test('draws the reverse mark with cream petals and a yolk disc', () => {
    const html = renderToString(h(DaisyMark, { size: 24, variant: 'reverse' }));
    assert({
      given: 'the reverse variant',
      should: 'use cream petals and a yolk disc, with no mask',
      actual: [
        new Set(petalClasses(html)),
        discClass(html),
        html.includes('<mask'),
      ],
      expected: [new Set(['fill-cream']), 'fill-yolk', false],
    });
  });

  test('draws a shape it is given instead of the committed one', () => {
    const shape = { ...petalShape, length: 6 };
    const html = renderToString(
      h(DaisyMark, { size: 24, variant: 'primary', shape }),
    );
    assert({
      given: 'a preview shape',
      should: 'draw its petals from that shape',
      actual: [
        html.includes(
          `d="${petalPath(shape, { tip: [12, 12 - markGeometry.petalInset], angle: 0 })}"`,
        ),
        html.includes(`d="${uprightPetal}"`),
      ],
      expected: [true, false],
    });
  });
});

describe('DaisyTile', () => {
  test('sits a reverse bloom on a forest rounded square', () => {
    const html = renderToString(h(DaisyTile, { size: 16 }));
    assert({
      given: 'the favicon tile',
      should:
        'render a stage-coloured rounded square under eight cream petals and a yolk disc, aria-hidden',
      actual: [
        /<rect [^>]*rx="5.5"[^>]*class="fill-surface-stage"/.test(html),
        petalClasses(html).length,
        new Set(petalClasses(html)),
        html.includes('class="fill-yolk"'),
        html.includes('aria-hidden="true"'),
        html.includes('width="16"'),
      ],
      expected: [true, 8, new Set(['fill-cream']), true, true, true],
    });
  });
});

describe('DaisyLogo', () => {
  test('is the primary mark at logo size, with no tile', () => {
    const html = renderToString(h(DaisyLogo));
    assert({
      given: 'the logo',
      should:
        'render the primary bloom at the shell logo size, with no accent tile and no mask',
      actual: [
        petalClasses(html).includes('fill-mark-cardinal'),
        discClass(html),
        html.includes('size-shell-logo'),
        html.includes('bg-accent'),
        html.includes('<mask'),
      ],
      expected: [true, 'fill-yolk', true, false, false],
    });
  });
});
