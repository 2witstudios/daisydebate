import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { helpTopics } from '../../../features/help/topics';
import { routeExists } from '../../test-support/route-exists';
import { pageColourClasses } from '../../test-support/stage-palette';
import { AboutPage } from './about-page';

setupRitewayBun();

const appDirectory = join(import.meta.dir, '../../../app');

const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1] as string);

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');

describe('AboutPage', () => {
  test('the vision and the founder’s note', () => {
    const page = text(renderToString(h(AboutPage, {})));
    assert({
      given: 'the About page',
      should: 'state the vision, its three points and the founder’s quote',
      actual: [
        'Debate is a sport. It deserves a venue.',
        'Open all the time',
        'One ladder to claim',
        'A home for every league',
        'Free speech carries the responsibility to speak truthfully, and with that, the right to speak deceitfully.',
        'Jono, founder',
      ].map((line) => page.includes(line)),
      expected: Array(6).fill(true),
    });
  });

  test('the case for Daisy appears only once it has an address', () => {
    assert({
      given: 'no published case, then one',
      should: 'leave the 1AC card out, then link it',
      actual: [
        renderToString(h(AboutPage, { caseHref: null })).includes('1AC'),
        hrefs(renderToString(h(AboutPage, { caseHref: '/the-case' }))).includes(
          '/the-case',
        ),
      ],
      expected: [false, true],
    });
  });

  test('the common questions are Help’s own', () => {
    const page = renderToString(h(AboutPage, {}));
    const asked = [...page.matchAll(/href="\/help#([^"]+)">([^<]+)</g)].map(
      ([, id, question]) => [id, question?.replace(/&#x27;/g, "'")],
    );
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
    const links = hrefs(renderToString(h(AboutPage, {})));
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

  test('the seasons band keeps to stage colours', () => {
    const html = renderToString(h(AboutPage, {}));
    const band = html.slice(
      html.indexOf('bg-surface-stage'),
      html.indexOf('</section>', html.indexOf('bg-surface-stage')),
    );
    assert({
      given: 'the forest seasons band',
      should: 'draw no page-palette colour on the stage',
      actual: pageColourClasses(band),
      expected: [],
    });
  });
});
