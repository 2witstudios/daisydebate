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
  /<circle cx="12" cy="12" r="2.5" class="([^"]+)"/.exec(html)?.[1];

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

  test('colours the primary mark forest, sage and butter', () => {
    const html = renderToString(h(DaisyMark, { size: 24, variant: 'primary' }));
    assert({
      given: 'the primary variant',
      should:
        'alternate forest cardinals with sage diagonals around a butter disc',
      actual: [petalClasses(html), discClass(html)],
      expected: [
        [
          'fill-forest',
          'fill-sage',
          'fill-forest',
          'fill-sage',
          'fill-forest',
          'fill-sage',
          'fill-forest',
          'fill-sage',
        ],
        'fill-butter',
      ],
    });
  });

  test('draws the mono mark in currentColor with a ring knocked out of the petals', () => {
    const html = renderToString(h(DaisyMark, { size: 24, variant: 'mono' }));
    const maskId = /<mask id="([^"]+)"/.exec(html)?.[1];
    assert({
      given: 'the mono variant',
      should:
        'fill every petal and the disc with currentColor and mask a ring wider than the disc',
      actual: [
        new Set(petalClasses(html)),
        discClass(html),
        html.includes(`<g mask="url(#${maskId})">`),
        html.includes(
          `r="${markGeometry.discRadius + markGeometry.ringGap}" fill="black"`,
        ),
      ],
      expected: [new Set(['fill-current']), 'fill-current', true, true],
    });
  });

  test('gives each mono mark its own mask', () => {
    const html = renderToString(
      h('div', null, [
        h(DaisyMark, { key: 'a', size: 24, variant: 'mono' }),
        h(DaisyMark, { key: 'b', size: 24, variant: 'mono' }),
      ]),
    );
    const ids = [...html.matchAll(/<mask id="([^"]+)"/g)].map(([, id]) => id);
    assert({
      given: 'two mono marks on one page',
      should: 'give them different mask ids',
      actual: new Set(ids).size,
      expected: 2,
    });
  });

  test('draws the reverse mark with cream petals and a butter disc', () => {
    const html = renderToString(h(DaisyMark, { size: 24, variant: 'reverse' }));
    assert({
      given: 'the reverse variant',
      should: 'use cream petals and a butter disc, with no mask',
      actual: [
        new Set(petalClasses(html)),
        discClass(html),
        html.includes('<mask'),
      ],
      expected: [new Set(['fill-cream']), 'fill-butter', false],
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
        'render a stage-coloured rounded square under eight cream petals and a butter disc, aria-hidden',
      actual: [
        /<rect [^>]*rx="5.5"[^>]*class="fill-surface-stage"/.test(html),
        petalClasses(html).length,
        new Set(petalClasses(html)),
        html.includes('class="fill-butter"'),
        html.includes('aria-hidden="true"'),
        html.includes('width="16"'),
      ],
      expected: [true, 8, new Set(['fill-cream']), true, true, true],
    });
  });
});

describe('DaisyLogo', () => {
  test('sits the mono mark on the accent tile', () => {
    const html = renderToString(h(DaisyLogo));
    assert({
      given: 'the logo',
      should: 'wrap a mono teardrop mark in the accent tile',
      actual: [
        html.includes('bg-accent'),
        html.includes('<mask'),
        html.includes('<ellipse'),
      ],
      expected: [true, true, false],
    });
  });
});
