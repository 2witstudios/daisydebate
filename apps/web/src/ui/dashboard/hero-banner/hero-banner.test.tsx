import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { HeroBanner } from './hero-banner';
import { art } from '../../assets';

setupRitewayBun();

describe('HeroBanner', () => {
  test('owns the page heading and describes its photograph', () => {
    const html = renderToString(h(HeroBanner));
    assert({
      given: 'the hero banner',
      should: 'render the headline as the h1 and the registered alt text',
      actual: [
        /<h1[^>]*>Join the marketplace of ideas<\/h1>/.test(html),
        html.includes(`alt="${art.heroRidge.alt}"`),
      ],
      expected: [true, true],
    });
  });
});
