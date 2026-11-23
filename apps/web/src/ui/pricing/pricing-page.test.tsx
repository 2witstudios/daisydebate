import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
import { planActions } from '../../features/pricing/plan-actions';
import {
  planPrices,
  type PlanPrices,
} from '../../features/pricing/plan-prices';
import { PricingPage } from './pricing-page';
setupRitewayBun();

// Checkout and host tiers released; Club and League not yet.
const closed = planActions({
  premiumCheckout: true,
  hostTiers: true,
  clubSeats: false,
  leagueRequests: false,
});
const open = planActions({
  premiumCheckout: true,
  hostTiers: true,
  clubSeats: true,
  leagueRequests: true,
});
const render = (actions = closed, prices: PlanPrices = planPrices) =>
  renderAccessible(<PricingPage prices={prices} actions={actions} />);

/** The card region named by `name`, so assertions stay inside one card. */
const cardOf = (view: AccessibleView, name: string): AccessibleView =>
  view.within('region', name);

/** Every piece of text inside an element, one cell per text node. */
const cells = (element: Element): readonly string[] =>
  [...element.childNodes].flatMap((child) =>
    child.nodeType === child.TEXT_NODE
      ? (child.textContent ?? '').trim() === ''
        ? []
        : [child.textContent ?? '']
      : cells(child as Element),
  );

/** A card's price line under its heading, as [price, period]. */
const priceOf = (view: AccessibleView, name: string) => {
  const line = cardOf(view, name).get('heading', name).nextElementSibling;
  return line === null ? [] : cells(line);
};

/** Each Host tier row as [name, detail, price], read inside its own row. */
const hostTiers = (view: AccessibleView) =>
  cardOf(view, 'Host')
    .all('listitem')
    .map(cells)
    .filter((row) => row.length === 3);

const hrefsIn = (view: AccessibleView): readonly string[] =>
  view.all('link').map((link) => link.getAttribute('href') ?? '');

const plans = ['Premium', 'Club', 'Host', 'League'];

test('the four plan cards', () => {
  const view = render();
  assert({
    given: 'the pricing page',
    should: 'show Premium, Club, Host and League, each a labelled section',
    actual: plans.map((name) =>
      cardOf(view, name).has('heading', name, { level: 2 }),
    ),
    expected: [true, true, true, true],
  });
  assert({
    given: 'the decided prices',
    should:
      'show Premium monthly, Club per seat, Host free with its event tiers and League on request',
    actual: [
      priceOf(view, 'Premium'),
      priceOf(view, 'Club'),
      hostTiers(view),
      priceOf(view, 'League'),
    ],
    expected: [
      ['$20', 'a month'],
      ['$10', 'per seat, a month'],
      [
        [
          'Free',
          'Up to 16 entries. No recording, AI judging or broadcast.',
          '$0',
        ],
        ['Up to 64 entries', 'One payment for one event.', '$99'],
        ['Unlimited entries', 'One payment for one event.', '$199'],
      ],
      ['Talk to us'],
    ],
  });
  assert({
    given: 'Club seats and League requests not yet released',
    should:
      'link Premium to billing checkout and Host to /host, and show Club and League as coming soon with no link',
    actual: [
      hrefsIn(cardOf(view, 'Premium')),
      hrefsIn(cardOf(view, 'Host')),
      hrefsIn(cardOf(view, 'Club')),
      cardOf(view, 'Club').textContent().includes('Coming soon'),
      hrefsIn(cardOf(view, 'League')),
      cardOf(view, 'League').textContent().includes('Coming soon'),
    ],
    expected: [['/settings/billing'], ['/host'], [], true, [], true],
  });
  const released = render(open);
  assert({
    given: 'both released',
    should: 'link Start a Club to /clubs/new and Talk to us to the League form',
    actual: [
      hrefsIn(cardOf(released, 'Club')),
      cardOf(released, 'Club').attribute('link', 'Start a Club', 'href'),
      hrefsIn(cardOf(released, 'League')),
      released.textContent().includes('Coming soon'),
    ],
    expected: [['/clubs/new'], '/clubs/new', ['/contact/league'], false],
  });
});

test('prices come from the catalogue, never from copy', () => {
  const view = render(closed, {
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
      priceOf(view, 'Premium')[0],
      priceOf(view, 'Club')[0],
      view
        .textContent()
        .includes(
          'up to 12 entries. Upgrade one event when it needs more entries or video: $89 up to 48 entries, $179 unlimited.',
        ),
    ],
    expected: ['$25', '$12.50', true],
  });
  assert({
    given: 'different catalogue tiers',
    should: 'pair each Host tier with its own price in its own row',
    actual: hostTiers(view).map(([name, , price]) => [name, price]),
    expected: [
      ['Free', '$0'],
      ['Up to 48 entries', '$89'],
      ['Unlimited entries', '$179'],
    ],
  });
  assert({
    given: 'different catalogue prices',
    should: 'leave no default price behind',
    actual: /\$20|\$10|\$99|\$199|16 entries|64 entries/.test(
      view.textContent(),
    ),
    expected: false,
  });
});

test('what free includes and the questions', () => {
  const view = render();
  const free = cardOf(view, 'Free, always');
  assert({
    given: 'the pricing page',
    should: 'say what every account gets free',
    actual: [
      'Debate other people, casual and ranked',
      'AI judging on every ranked Round',
      'One Round analysis, to try it',
    ].filter((line) => !free.textContent().includes(line)),
    expected: [],
  });
  assert({
    given: 'the whole pricing page',
    should: 'promise no bot debates anywhere (BCS-7)',
    actual: /\bbots?\b/i.test(view.textContent()),
    expected: false,
  });
  const disclosures = (page: AccessibleView) =>
    page.all('group').map((disclosure) => disclosure.hasAttribute('open'));
  const familyQuestion = 'Can I buy Premium for my children?';
  assert({
    given: 'the questions while Club is not yet released',
    should:
      'be four native disclosures with only the first open, leaving out the family answer that points at Start a Club',
    actual: [disclosures(view), view.textContent().includes(familyQuestion)],
    expected: [[true, false, false, false], false],
  });
  const released = render(open);
  assert({
    given: 'Club released',
    should: 'add the family question, still with only the first open',
    actual: [
      disclosures(released),
      released.textContent().includes(familyQuestion),
      released.textContent().includes('Yes. Start a Club for your family'),
    ],
    expected: [[true, false, false, false, false], true, true],
  });
  assert({
    given: 'the fair-use and ranked questions',
    should:
      'say Premium has no counters behind a fair-use ceiling, and name the Open and Youth ladders by age',
    actual: [
      'What does unlimited mean?',
      'There are no counters. A fair-use ceiling stops scripts and abuse',
      'Who plays ranked?',
      'members 18 and over',
      'play ranked in the Youth lobby',
      'How does Host pricing work?',
      '$99 up to 64 entries, $199 unlimited. Nothing renews.',
    ].filter((line) => !view.textContent().includes(line)),
    expected: [],
  });
});

test('page structure', () => {
  const view = render();
  assert({
    given: 'the pricing page',
    should:
      'have one h1, and h2s for each plan, the free band and the questions',
    actual: [
      view.count('heading', undefined, { level: 1 }),
      view.names('heading', { level: 2 }),
    ],
    expected: [
      1,
      ['Premium', 'Club', 'Host', 'League', 'Free, always', 'Questions'],
    ],
  });
  assert({
    given: 'the page',
    should: 'state the currency and carry nothing to post',
    actual: [
      view.textContent().includes('Prices in US dollars.'),
      ['button', 'textbox', 'checkbox'].some((role) => view.count(role) > 0),
    ],
    expected: [true, false],
  });
});
