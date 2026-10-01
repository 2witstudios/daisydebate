import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { rankedRules } from '../../../features/ranked/rules';
import { RulesDrawer } from './rules-drawer';

setupRitewayBun();

const html = renderToString(
  h(RulesDrawer, {
    rules: rankedRules({ provisionalDebates: 10, checkInGraceSeconds: 40 }),
    closeHref: '/ranked',
  }),
);

describe('RulesDrawer', () => {
  test('states every rule', () => {
    assert({
      given: 'the four rules',
      should: 'list each title',
      actual: [
        'Standard rules',
        'Assigned judge',
        'Conduct',
        'How ranked works',
      ].map((title) => html.includes(title)),
      expected: [true, true, true, true],
    });
  });

  test('closes by link', () => {
    assert({
      given: 'a close URL',
      should: 'link the scrim, Close and Got it back to it, with no button',
      actual: [
        html.match(/href="\/ranked"/g)?.length,
        html.includes('<button'),
      ],
      expected: [3, false],
    });
  });

  test('is labelled by its heading', () => {
    assert({
      given: 'the drawer',
      should: 'name the region from its title',
      actual:
        html.includes('aria-labelledby="ranked-rules-title"') &&
        html.includes('id="ranked-rules-title"'),
      expected: true,
    });
  });
});
