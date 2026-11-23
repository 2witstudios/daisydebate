import { createElement as h, type ComponentType } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { HeroBanner } from '../ui/dashboard/hero-banner/hero-banner';
import { MemberHero } from '../ui/dashboard/member-hero/member-hero';
import { initialLinkForm } from '../ui/auth/request-link';
import { createInitialState } from '../ui/store/state';
import { UiStoreProvider } from '../ui/store/store';

setupRitewayBun();

const HeroBannerWithLink = () =>
  h(HeroBanner, { requestLink: () => Promise.resolve(initialLinkForm) });

const MemberHeroWithoutRoom = () =>
  h(MemberHero, { username: 'ada-byron', activeRoom: null });

/** Whether the one photograph carries every layering class. */
const layered = (html: string) => {
  const tag = /<img\b[^>]*>/.exec(html)?.[0] ?? '';
  const classes = /\sclass="([^"]*)"/.exec(tag)?.[1] ?? '';
  return ['absolute', 'inset-0', 'size-full'].every((name) =>
    classes.split(/\s+/).includes(name),
  );
};

/**
 * Layering a photograph under its surface is a design-system class contract
 * (absolute inset-0 size-full): the photo's role, name and intrinsic size are
 * asserted by role in ui/dashboard/photo-layers.test.tsx, and nothing but the
 * classes says how it is laid out.
 */
describe('dashboard photographs markup (ISSUE-19)', () => {
  const surfaces: ReadonlyArray<[string, ComponentType]> = [
    ['HeroBanner', HeroBannerWithLink],
    ['MemberHero', MemberHeroWithoutRoom],
  ];

  test('layer the photograph by class', () => {
    assert({
      given: 'each dashboard surface that lays a photograph under its content',
      should: 'layer it by class (absolute inset-0 size-full)',
      actual: surfaces.map(([name, surface]) => ({
        name,
        layered: layered(
          renderMarkup(
            h(UiStoreProvider, {
              initialState: createInitialState(),
              children: h(surface),
            }),
          ),
        ),
      })),
      expected: surfaces.map(([name]) => ({ name, layered: true })),
    });
  });
});
