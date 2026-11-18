import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderToStaticMarkup } from 'react-dom/server';
import { planActions } from '../../features/pricing/plan-actions';
import {
  planPrices,
  type PlanPrices,
} from '../../features/pricing/plan-prices';
import { PricingPage } from './pricing-page';
setupRitewayBun();

const closed = planActions({ clubSeats: false, leagueRequests: false });
const open = planActions({ clubSeats: true, leagueRequests: true });
const render = (actions = closed, prices: PlanPrices = planPrices) =>
  renderToStaticMarkup(<PricingPage prices={prices} actions={actions} />);

/** The card section headed by `name`, so assertions stay inside one card. */
const cardOf = (html: string, name: string): string => {
  const start = html.indexOf(`aria-labelledby="plan-${name.toLowerCase()}"`);
  return start === -1
    ? ''
    : html.slice(start, html.indexOf('</section>', start));
};

const hrefsIn = (html: string): readonly string[] =>
  [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? '');

test('the four plan cards', () => {
  const html = render();
  assert({
    given: 'the pricing page',
    should: 'show Premium, Club, Host and League, each a labelled section',
    actual: ['Premium', 'Club', 'Host', 'League'].map((name) =>
      cardOf(html, name).includes(`>${name}</h2>`),
    ),
    expected: [true, true, true, true],
  });
  assert({
    given: 'the decided prices',
    should:
      'show Premium monthly, Club per seat, Host free with its event tiers and League on request',
    actual: [
      cardOf(html, 'Premium').includes(
        '$20</span><span class="text-ink-muted">a month',
      ),
      cardOf(html, 'Club').includes(
        '$10</span><span class="text-ink-muted">per seat, a month',
      ),
      [
        'Up to 16 entries. No recording, AI judging or broadcast.',
        '$0',
        'Up to 64 entries',
        '$99',
        'Unlimited entries',
        '$199',
      ].filter((text) => !cardOf(html, 'Host').includes(text)),
      cardOf(html, 'League').includes('>Talk to us</span>'),
    ],
    expected: [true, true, [], true],
  });
  assert({
    given: 'Club seats and League requests not yet released',
    should:
      'link Premium to billing checkout and Host to /host, and show Club and League as coming soon with no link',
    actual: [
      hrefsIn(cardOf(html, 'Premium')),
      hrefsIn(cardOf(html, 'Host')),
      hrefsIn(cardOf(html, 'Club')),
      cardOf(html, 'Club').includes('Coming soon'),
      hrefsIn(cardOf(html, 'League')),
      cardOf(html, 'League').includes('Coming soon'),
    ],
    expected: [['/settings/billing'], ['/host'], [], true, [], true],
  });
  const released = render(open);
  assert({
    given: 'both released',
    should: 'link Start a Club to /clubs/new and Talk to us to the League form',
    actual: [
      hrefsIn(cardOf(released, 'Club')),
      cardOf(released, 'Club').includes('>Start a Club</a>'),
      hrefsIn(cardOf(released, 'League')),
      released.includes('Coming soon'),
    ],
    expected: [['/clubs/new'], true, ['/contact/league'], false],
  });
  assert({
    given: 'the featured plan',
    should: 'give only Premium the strong outline',
    actual: ['Premium', 'Club', 'Host', 'League'].map((name) =>
      cardOf(html, name).includes('border-2 border-accent'),
    ),
    expected: [true, false, false, false],
  });
});

test('prices come from the catalogue, never from copy', () => {
  const html = render(closed, {
    ...planPrices,
    premiumMonthlyCents: 2500,
    clubSeatMonthlyCents: 1250,
    host: {
      freeEntryLimit: 12,
      eventUpgrades: [
        { entryLimit: 48, cents: 8900 },
        { entryLimit: null, cents: 17900 },
      ],
    },
  });
  assert({
    given: 'different catalogue prices',
    should: 'show those prices in the cards and the Host answer',
    actual: [
      '$25</span>',
      '$12.50</span>',
      'Up to 12 entries.',
      'Up to 48 entries',
      '$89',
      '$179',
      'up to 12 entries. Upgrade one event when it needs more entries or video: $89 up to 48 entries, $179 unlimited.',
    ].filter((text) => !html.includes(text)),
    expected: [],
  });
  assert({
    given: 'different catalogue prices',
    should: 'leave no default price behind',
    actual: /\$20|\$10|\$99|\$199|16 entries|64 entries/.test(html),
    expected: false,
  });
});

test('what free includes and the questions', () => {
  const html = render();
  assert({
    given: 'the pricing page',
    should: 'say what every account gets free',
    actual: [
      'Free, always',
      'Debate other people, casual and ranked',
      'AI judging on every ranked Round',
      'One bot Round, one AI-judged casual Round and one analysis to try them',
    ].filter((text) => !html.includes(text)),
    expected: [],
  });
  const questions = [...html.matchAll(/<details[^>]*>/g)].map((m) => m[0]);
  assert({
    given: 'the questions',
    should: 'be five native disclosures with only the first open',
    actual: questions.map((tag) => tag.includes(' open=""')),
    expected: [true, false, false, false, false],
  });
  assert({
    given: 'the fair-use and ranked questions',
    should:
      'say Premium has no counters behind a fair-use ceiling, and name the Open and Youth ladders by age',
    actual: [
      'What does unlimited mean?',
      'There are no counters. A fair-use ceiling stops scripts and abuse',
      'Who plays ranked?',
      'members 18 and over on Open – Freestyle',
      'members under 18 on Youth – Freestyle',
      'How does Host pricing work?',
      '$99 up to 64 entries, $199 unlimited. Nothing renews.',
    ].filter((text) => !html.includes(text)),
    expected: [],
  });
});

test('page structure', () => {
  const html = render();
  assert({
    given: 'the pricing page',
    should:
      'have one h1, and h2s for each plan, the free band and the questions',
    actual: [
      (html.match(/<h1/g) ?? []).length,
      [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]),
    ],
    expected: [
      1,
      ['Premium', 'Club', 'Host', 'League', 'Free, always', 'Questions'],
    ],
  });
  assert({
    given: 'the page',
    should: 'state the currency and carry no form',
    actual: [html.includes('Prices in US dollars.'), html.includes('<form')],
    expected: [true, false],
  });
});
