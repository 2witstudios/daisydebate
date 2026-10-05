import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PartBars } from './part-bars';
import { StructureTrend } from './structure-trend';

setupRitewayBun();

describe('StructureTrend', () => {
  test('describes the chart in words', () => {
    const html = renderToString(h(StructureTrend, { trend: [48, 52, 74] }));
    assert({
      given: 'a rising trend',
      should: 'label the image with its start and end',
      actual: [
        html.includes('from 48 to 74 percent over 3 weeks'),
        html.includes('74%'),
      ],
      expected: [true, true],
    });
  });
});

describe('PartBars', () => {
  test('flags only the weakest part', () => {
    const html = renderToString(
      h(PartBars, {
        parts: { claim: 92, warrant: 71, responding: 64, impact: 38 },
      }),
    );
    assert({
      given: 'impact as the lowest part',
      should: 'show one Weakest badge and every value',
      actual: [
        html.match(/Weakest/g)?.length,
        ['92%', '71%', '64%', '38%'].every((v) => html.includes(v)),
        html.match(/role="meter"/g)?.length,
      ],
      expected: [1, true, 4],
    });
  });
});
