import { join } from 'node:path';
import { clubSeatBounds } from '@daisy/protocol/club-seats';
import type { ReactElement } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ballotCategoryCount,
  ballotGroups,
} from '../../features/marketing/ballot-card';
import type { AudienceLinks } from '../../features/marketing/links';
import {
  closedLinks,
  openLinks,
} from '../../features/marketing/links.test-support';
import { ncfcaTimes } from '../../features/marketing/ncfca-times';
import { planPrices } from '../../features/pricing/plan-prices';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { routeExists } from '../test-support/route-exists';
import { AboutPage } from '../about/about-page/about-page';
import { CoachPage } from './coach-page';
import { LeaguesPage } from './leagues-page';
import { NcfcaPage } from './ncfca-page';
import { ParentsPage } from './parents-page';
import { TabPage } from './tab-page';

setupRitewayBun();

const appDirectory = join(import.meta.dir, '../../app');

const pages: Readonly<Record<string, (links: AudienceLinks) => ReactElement>> =
  {
    ncfca: (links) => (
      <NcfcaPage
        times={ncfcaTimes()}
        categoryCount={ballotCategoryCount()}
        prices={planPrices}
        links={links}
      />
    ),
    parents: (links) => <ParentsPage prices={planPrices} links={links} />,
    coach: (links) => (
      <CoachPage
        prices={planPrices}
        links={links}
        seatLimit={clubSeatBounds.maxSeats}
        ballot={{
          groups: ballotGroups(),
          categoryCount: ballotCategoryCount(),
        }}
      />
    ),
    leagues: (links) => <LeaguesPage links={links} />,
    tab: (links) => <TabPage prices={planPrices} links={links} />,
  };

const hrefsOf = (view: ReturnType<typeof renderAccessible>) =>
  view.all('link').map((link) => link.getAttribute('href') as string);

describe('the audience pages', () => {
  test('each speaks to its reader and leads to its own action', () => {
    const shown = (name: string) => renderAccessible(pages[name]!(openLinks));
    assert({
      given: 'each page with every release open',
      should: 'carry its title and send its main action to the right place',
      actual: [
        [
          shown('ncfca').has(
            'heading',
            'Practice rounds between NCFCA tournaments',
            { level: 1 },
          ),
          shown('ncfca')
            .all('link', 'Sign up your student')[0]
            ?.getAttribute('href'),
          shown('ncfca').attribute(
            'link',
            'I’m a student, 13 or older',
            'href',
          ),
        ],
        [
          shown('parents').has('heading', 'Introduce your kid to debate', {
            level: 1,
          }),
          shown('parents')
            .all('link', 'Sign up your child')[0]
            ?.getAttribute('href'),
        ],
        [
          shown('coach').has(
            'heading',
            'Give your club more rounds than your schedule allows',
            { level: 1 },
          ),
          shown('coach').all('link', 'Start a Club')[0]?.getAttribute('href'),
        ],
        [
          shown('leagues').has('heading', 'Run your league’s season on Daisy', {
            level: 1,
          }),
          shown('leagues').all('link', 'Talk to us')[0]?.getAttribute('href'),
        ],
        [
          shown('tab').has('heading', 'Tab your tournament on Daisy', {
            level: 1,
          }),
          shown('tab')
            .all('link', 'Host a tournament')[0]
            ?.getAttribute('href'),
        ],
      ],
      expected: [
        [true, '/settings/parental-controls', '/sign-in'],
        [true, '/settings/parental-controls'],
        [true, '/clubs/new'],
        [true, '/contact/league'],
        [true, '/host'],
      ],
    });
  });

  test('every link leads to a page that exists', () => {
    assert({
      given: 'every link on every page, with every release open',
      should: 'find a page or a Help topic behind each',
      actual: Object.values(pages).flatMap((page) =>
        hrefsOf(renderAccessible(page(openLinks)))
          .map((href) => href.split('#')[0] as string)
          .filter((href) => !routeExists(appDirectory, href)),
      ),
      expected: [],
    });
  });

  test('a closed release leaves its link out and is never promised', () => {
    const closed = Object.entries(pages).map(([name, page]) => {
      const view = renderAccessible(page(closedLinks));
      return [name, hrefsOf(view), /coming soon/i.test(view.textContent())];
    });
    assert({
      given: 'each page with every release closed',
      should:
        'link only to sign-in and Help, and never say something is coming soon',
      actual: closed,
      expected: [
        ['ncfca', ['/sign-in', '/sign-in'], false],
        ['parents', [], false],
        ['coach', [], false],
        ['leagues', ['/help#ratings'], false],
        ['tab', [], false],
      ],
    });
  });

  test('prices and times are the product’s own', () => {
    const text = (name: string) =>
      renderAccessible(pages[name]!(openLinks)).textContent();
    assert({
      given: 'the pages beside the prices, seat bound and catalog they read',
      should: 'state each amount and time from its owner',
      actual: [
        text('ncfca').includes('Premium is $20 a month'),
        text('ncfca').includes('a family Club is $10 per seat, a month'),
        text('ncfca').includes('AC 6, CX 3, NC 7, CX 3, 1AR 4, NR 6, 2AR 3'),
        text('ncfca').includes('Prep 5 minutes a side'),
        text('coach').includes('$10 per seat, a month, from 1 to 200 seats'),
        text('coach').includes('A club of 12 is $120 a month'),
        text('coach').includes('in 10 categories'),
        text('ncfca').includes('scores in 10 categories for each side'),
        text('tab').includes('Free up to 16 entries'),
        text('tab').includes(
          'Moving from $99 to $199 costs the $100 difference',
        ),
        text('parents').includes('Premium is $20 a month'),
      ],
      expected: Array(11).fill(true),
    });
  });

  test('the NCFCA page promises no parental control while that release is closed', () => {
    const words = (links: AudienceLinks) =>
      renderAccessible(pages.ncfca!(links)).textContent();
    assert({
      given: 'the NCFCA page with parental controls open, then closed',
      should:
        'describe linking accounts only while a parent can, and lead a student to sign up either way',
      actual: [
        words(openLinks).includes('Link your account to theirs'),
        words(closedLinks).includes('Link your account to theirs'),
        words(closedLinks).includes('Sign up your student'),
        renderAccessible(pages.ncfca!(closedLinks)).attribute(
          'link',
          'Sign up',
          'href',
        ),
      ],
      expected: [true, false, false, '/sign-in'],
    });
  });

  test('NCFCA is named only with its non-affiliation line, and no page offers a bot', () => {
    const texts = Object.values(pages).map((page) =>
      renderAccessible(page(openLinks)).textContent(),
    );
    assert({
      given: 'the NCFCA page and every page’s words',
      should:
        'say Daisy is not affiliated with NCFCA, and offer no bot while bot debates are unreleased',
      actual: [
        texts[0]?.includes(
          'Daisy Debate is not affiliated with, endorsed by or sponsored by NCFCA.',
        ),
        texts.some((words) => /\bbots?\b/i.test(words)),
      ],
      expected: [true, false],
    });
  });
});

describe('About’s Daisy for row', () => {
  test('lists each audience page that is open', () => {
    const row = (links: AudienceLinks) =>
      hrefsOf(
        renderAccessible(<AboutPage audience={links} />).within(
          'navigation',
          'Daisy for',
        ),
      );
    assert({
      given: 'every release open, and every release closed',
      should: 'link all five pages, or only the one that needs no release',
      actual: [row(openLinks), row(closedLinks)],
      expected: [
        ['/ncfca', '/parents', '/coach', '/leagues', '/tab'],
        ['/ncfca'],
      ],
    });
  });
});
