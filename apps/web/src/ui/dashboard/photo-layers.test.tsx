import { createElement as h, type ComponentType } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { FeaturedTournament } from './featured-tournament/featured-tournament';
import { HeroBanner } from './hero-banner/hero-banner';
import { MemberHero } from './member-hero/member-hero';
import { initialLinkForm } from '../auth/request-link';
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
    layered: ['absolute', 'inset-0', 'size-full'].every((name) =>
      (attribute('class') ?? '').split(/\s+/).includes(name),
    ),
  };
};

const HeroBannerWithLink = () =>
  h(HeroBanner, { requestLink: () => Promise.resolve(initialLinkForm) });

const MemberHeroWithoutRoom = () =>
  h(MemberHero, { username: 'ada-byron', activeRoom: null });

describe('dashboard photographs (ISSUE-19)', () => {
  const surfaces: ReadonlyArray<[string, ComponentType, string, string]> = [
    ['HeroBanner', HeroBannerWithLink, '1925', '817'],
    ['MemberHero', MemberHeroWithoutRoom, '1925', '817'],
    ['FeaturedTournament', FeaturedTournament, '1600', '1065'],
  ];

  test('size from intrinsic dimensions, never an inline full-bleed overlay', () => {
    assert({
      given: 'each dashboard surface that lays a photograph under its content',
      should:
        'carry the photo with its intrinsic size and layer it by class (absolute inset-0 size-full), so without the stylesheet it cannot span the viewport over the shell',
      actual: surfaces.map(([name, surface]) => ({
        name,
        ...photoOf(renderInStore(h(surface))),
      })),
      expected: surfaces.map(([name, , width, height]) => ({
        name,
        width,
        height,
        inlinePosition: false,
        layered: true,
      })),
    });
  });
});
