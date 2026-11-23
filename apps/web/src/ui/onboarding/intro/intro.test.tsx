import { join } from 'node:path';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import { destinationHref } from '../../../features/destinations/destinations';
import { hostRoutes } from '../../../features/tab/routes';
import { routeExists } from '../../test-support/route-exists';
import { StylesStep } from './styles-step';
import { DebateStep } from './debate-step';
import { PracticeStep } from './practice-step';
import { HostStep } from './host-step';
import { catalogTemplates } from './templates';
import { drawSize, freestylePreset } from './freestyle';
import { DaisyStep, type IntroStepProps } from './intro';

setupRitewayBun();

const appDirectory = join(import.meta.dir, '../../../app');

const props: IntroStepProps = {
  nextHref: '/onboarding/next?next=%2Flobby',
  backHref: '/onboarding/back?next=%2Flobby',
  skip: null,
};

const daisy = (tabReleased: boolean) =>
  renderAccessible(h(DaisyStep, { ...props, tabReleased }));
const host = (tabReleased: boolean) =>
  renderAccessible(h(HostStep, { ...props, tabReleased }));
const styles = () => renderAccessible(h(StylesStep, props));
const debate = () => renderAccessible(h(DebateStep, props));
const practice = () => renderAccessible(h(PracticeStep, props));

/** A node's text with a space at every element edge, so cells read apart. */
const spaced = (node: Node): string =>
  node.nodeType === node.TEXT_NODE
    ? (node.textContent ?? '')
    : [...node.childNodes].map((child) => ` ${spaced(child)} `).join('');

/** The slide's words, element by element, as a reader moves through them. */
const text = (view: AccessibleView) =>
  spaced(view.get('dialog')).replace(/\s+/g, ' ');

const hrefs = (view: AccessibleView) =>
  view.all('link').map((link) => link.getAttribute('href') as string);

/** A link's page, without its fragment, exists in the app router tree. */
const resolves = (href: string) =>
  routeExists(appDirectory, href.split('#')[0] as string);

const allSlides = () => [
  daisy(true),
  daisy(false),
  styles(),
  debate(),
  practice(),
  host(true),
  host(false),
];

describe('DaisyStep', () => {
  test('three ways to use Daisy', () => {
    const view = daisy(true);
    const page = text(view);
    assert({
      given: 'the opening slide',
      should:
        'name Compete, Practise your league and Run your league, in that order, with their tags',
      actual: [
        page.includes('1 of 8'),
        page.includes('How Daisy works'),
        page.indexOf('Compete Ranked') <
          page.indexOf('Practise your league Unranked'),
        page.indexOf('Practise your league Unranked') <
          page.indexOf('Run your league For leagues and hosts'),
        page.includes('1v1, about 45 min with prep'),
        page.includes('Online or in person'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('the draw lives on the Freestyle slide', () => {
    const page = text(daisy(true));
    assert({
      given: 'the opening slide',
      should: 'show no draw figure and no retired ladder',
      actual: [
        page.includes('Example draw'),
        ...['Three ladders', 'Policy and Value', 'Season 1'].map((label) =>
          page.includes(label),
        ),
      ],
      expected: [false, false, false, false],
    });
  });

  test('Daisy Tab not yet released', () => {
    const page = text(daisy(false));
    assert({
      given: 'a viewer Daisy Tab is not released to',
      should: 'tag Run your league as early access',
      actual: [
        page.includes('Run your league Early access'),
        page.includes('For leagues and hosts'),
      ],
      expected: [true, false],
    });
  });
});

describe('StylesStep', () => {
  test('Freestyle and its draw', () => {
    const view = styles();
    const page = text(view);
    assert({
      given: 'the second slide',
      should:
        'number the draw, the strikes (Neg first) and the catalog prep beside an example draw',
      actual: [
        '2 of 8',
        'Freestyle, Daisy’s standard',
        'built on American parliamentary debate',
        '1 5 resolutions are drawn',
        '2 The sides strike in turn Neg strikes first, then Aff',
        '3 20 minutes of prep, then go live',
        'Steps 1 and 2, as you’ll see them',
        'Homework should be banned Debating',
      ].map((line) => page.includes(line)),
      expected: Array(8).fill(true),
    });
    assert({
      given: 'the catalog’s Freestyle draw',
      should:
        'match the example: as many resolutions as it draws, Neg striking first',
      actual: [
        view.count('deletion') + 1,
        freestylePreset.resolutionDraw.enabled &&
          freestylePreset.resolutionDraw.firstStriker,
      ],
      expected: [drawSize, 'negative'],
    });
    assert({
      given: 'the example draw',
      should: 'strike four resolutions, two by each side',
      actual: [
        view.count('deletion'),
        page.split('Aff struck').length - 1,
        page.split('Neg struck').length - 1,
      ],
      expected: [4, 2, 2],
    });
  });
});

describe('DebateStep', () => {
  test('the turn bar follows the engine', () => {
    const view = debate();
    const page = text(view);
    assert({
      given: 'the bar',
      should: 'carry a text alternative naming every turn',
      actual: view.has(
        'list',
        'Turn order: Aff Case 5 min, Neg questions 2 min, Neg Case 6 min, Aff questions 2 min, Aff Reply 3 min, Neg Reply 5 min, Aff Close 3 min',
      ),
      expected: true,
    });
    assert({
      given: 'two 2-minute cross-examinations',
      should:
        'total 26 minutes of speaking and say prep is 20 minutes before the round, as Freestyle runs it',
      actual: [
        page.includes('A Freestyle round, step by step'),
        page.includes('The resolution'),
        page.includes(
          '26 minutes of speaking, plus 20 minutes of prep before the round begins, once the resolution is chosen.',
        ),
        page.includes('the other side has 2 minutes to question'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('every link goes somewhere', () => {
    const links = hrefs(debate()).filter(
      (href) => !href.startsWith('/onboarding/'),
    );
    assert({
      given: 'Find a casual round, Watch a debate and How ratings work',
      should:
        'point at existing routes, How ratings work at Help’s ratings answer, which every member can reach',
      actual: [links, links.filter((href) => !resolves(href))],
      expected: [
        [destinationHref('lobby'), destinationHref('watch'), '/help#ratings'],
        [],
      ],
    });
  });
});

describe('PracticeStep', () => {
  test('practise any format', () => {
    const page = text(practice());
    assert({
      given: 'the fourth slide',
      should: 'teach practising any format, unranked, from the catalog',
      actual: [
        page.includes('4 of 8'),
        page.includes('Practise your league Unranked'),
        page.includes('1 Pick your format'),
        page.includes('2 Bring your people'),
        page.includes('3 Debate, then read the ballot'),
        catalogTemplates.length > 0 &&
          catalogTemplates.every((name) => page.includes(name)),
        page.includes('IPDA'),
        page.includes('Your own rules'),
      ],
      expected: Array(8).fill(true),
    });
  });
});

describe('HostStep', () => {
  test('released', () => {
    const view = host(true);
    const page = text(view);
    assert({
      given: 'a viewer Daisy Tab is released to',
      should:
        'show league and tournament tools and lead to the Tournaments page, never the missing host landing',
      actual: [
        page.includes('5 of 8'),
        page.includes('Run your league For leagues and hosts'),
        page.includes('Your league'),
        page.includes('Your tournaments'),
        page.includes('in person at your venue'),
        hrefs(view).includes('/tournaments'),
        hrefs(view).some((href) => href.startsWith(hostRoutes.home)),
      ],
      expected: [true, true, true, true, true, true, false],
    });
  });

  test('not yet released', () => {
    const view = host(false);
    assert({
      given: 'a viewer Daisy Tab is not released to',
      should:
        'tag it early access and lead to the Tournaments page, never the host area',
      actual: [
        text(view).includes('Run your league Early access'),
        hrefs(view).includes('/tournaments'),
        hrefs(view).some((href) => href.startsWith(hostRoutes.home)),
      ],
      expected: [true, true, false],
    });
  });
});

describe('every intro slide', () => {
  test('one word for the debate’s subject', () => {
    assert({
      given: 'every slide',
      should: 'call it the resolution, never the motion or topic',
      actual: allSlides().map((view) =>
        /\b(motion|topic)s?\b/i.test(text(view)),
      ),
      expected: allSlides().map(() => false),
    });
  });

  test('links resolve, and back and next are the given hrefs', () => {
    const slides = allSlides();
    assert({
      given: 'every slide',
      should: 'link only to existing routes, Back and Next as given',
      actual: slides.map((view) => {
        const links = hrefs(view);
        return [
          links.includes(props.backHref as string),
          links.includes(props.nextHref),
          links
            .filter((href) => !href.startsWith('/onboarding/'))
            .filter((href) => !resolves(href)),
        ];
      }),
      expected: slides.map(() => [true, true, []]),
    });
  });
});
