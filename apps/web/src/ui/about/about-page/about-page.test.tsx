import { join } from 'node:path';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { helpTopics } from '../../../features/help/topics';
import { routeExists } from '../../test-support/route-exists';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { openLinks } from '../../../features/marketing/links.test-support';
import { AboutPage } from './about-page';

setupRitewayBun();

const appDirectory = join(import.meta.dir, '../../../app');

const hrefs = (view: ReturnType<typeof renderAccessible>) =>
  view.all('link').map((link) => link.getAttribute('href') as string);

describe('AboutPage', () => {
  test('the vision and the founder’s note', () => {
    const view = renderAccessible(h(AboutPage, { audience: openLinks }));
    const note = view.within('region', 'A note from the founder').textContent();
    assert({
      given: 'the About page',
      should: 'state the vision, its three points and the founder’s quote',
      actual: [
        view.has('heading', 'Debate is a sport. It deserves a venue.', {
          level: 1,
        }),
        view.has('heading', 'Open all the time', { level: 2 }),
        view.has('heading', 'One ladder to claim', { level: 2 }),
        view.has('heading', 'A home for every league', { level: 2 }),
        note.includes(
          'Free speech carries the responsibility to speak truthfully, and with that, the right to speak deceitfully.',
        ),
        note.includes('Jono, founder'),
      ],
      expected: Array(6).fill(true),
    });
  });

  test('the case for Daisy appears only once it has an address', () => {
    assert({
      given: 'no published case, then one',
      should: 'leave the 1AC card out, then link it',
      actual: [
        renderAccessible(h(AboutPage, { audience: openLinks, caseHref: null }))
          .textContent()
          .includes('1AC'),
        renderAccessible(
          h(AboutPage, { audience: openLinks, caseHref: '/the-case' }),
        ).attribute('link', '1AC The case for Daisy Debate', 'href'),
      ],
      expected: [false, '/the-case'],
    });
  });

  test('the common questions are Help’s own', () => {
    const asked = renderAccessible(h(AboutPage, { audience: openLinks }))
      .within('region', 'Common questions')
      .all('link')
      .flatMap((link) => {
        const href = link.getAttribute('href') ?? '';
        return href.startsWith('/help#')
          ? [[href.slice('/help#'.length), link.textContent] as const]
          : [];
      });
    assert({
      given: 'each common question on About',
      should: 'carry the Help topic’s own wording, six of them',
      actual: [
        asked.length,
        asked.filter(
          ([id, question]) =>
            helpTopics.find((topic) => topic.id === id)?.question !== question,
        ),
      ],
      expected: [6, []],
    });
  });

  test('every common question is answered on Help', () => {
    const links = hrefs(
      renderAccessible(h(AboutPage, { audience: openLinks })),
    );
    const ids = new Set(helpTopics.map((topic) => topic.id));
    assert({
      given: 'the common questions and every other link',
      should: 'point at Help topics that exist and at pages that exist',
      actual: [
        links
          .filter((href) => href.startsWith('/help#'))
          .filter((href) => !ids.has(href.slice('/help#'.length))),
        links
          .map((href) => href.split('#')[0] as string)
          .filter((href) => !routeExists(appDirectory, href)),
      ],
      expected: [[], []],
    });
  });
});
