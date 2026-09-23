import { createElement as h, type ComponentType } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { FeaturedTournament } from './featured-tournament/featured-tournament';
import { HeroBanner } from './hero-banner/hero-banner';
import { QuoteCard } from './quote-card/quote-card';
import { renderInStore } from '../test-support/render-in-store';

setupRitewayBun();

/** The attributes of the one photograph a surface renders. */
const photoOf = (html: string) => {
  const tag = /<img\b[^>]*>/.exec(html)?.[0] ?? '';
  const attribute = (name: string) =>
    new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
  return {
    width: attribute('width'),
    height: attribute('height'),
    inlinePosition: /position:\s*absolute/.test(attribute('style') ?? ''),
  };
};

describe('dashboard photographs (ISSUE-19)', () => {
  const surfaces: ReadonlyArray<[string, ComponentType, string, string]> = [
    ['QuoteCard', QuoteCard, '2200', '1311'],
    ['HeroBanner', HeroBanner, '2200', '1311'],
    ['FeaturedTournament', FeaturedTournament, '1600', '1065'],
  ];

  test('size from intrinsic dimensions, never an inline full-bleed overlay', () => {
    assert({
      given: 'each dashboard surface that lays a photograph under its content',
      should:
        'carry the photo as an in-flow image with its intrinsic size, so without the stylesheet it cannot span the viewport over the topbar',
      actual: surfaces.map(([name, surface]) => ({
        name,
        ...photoOf(renderInStore(h(surface))),
      })),
      expected: surfaces.map(([name, , width, height]) => ({
        name,
        width,
        height,
        inlinePosition: false,
      })),
    });
  });
});
