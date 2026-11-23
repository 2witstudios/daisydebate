import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { planActions } from '../features/pricing/plan-actions';
import { planPrices } from '../features/pricing/plan-prices';
import { PricingPage } from '../ui/pricing/pricing-page';

setupRitewayBun();

const html = renderMarkup(
  <PricingPage
    prices={planPrices}
    actions={planActions({
      premiumCheckout: true,
      hostTiers: true,
      clubSeats: false,
      leagueRequests: false,
    })}
  />,
);

/** The card section headed by `name`, so assertions stay inside one card. */
const cardOf = (name: string): string => {
  const start = html.indexOf(`aria-labelledby="plan-${name.toLowerCase()}"`);
  return start === -1
    ? ''
    : html.slice(start, html.indexOf('</section>', start));
};

/**
 * The featured plan's strong outline is a design-system visual contract with
 * no accessible equivalent.
 */
describe('PricingPage markup', () => {
  test('the featured plan', () => {
    assert({
      given: 'the featured plan',
      should: 'give only Premium the strong outline',
      actual: ['Premium', 'Club', 'Host', 'League'].map((name) =>
        cardOf(name).includes('border-2 border-accent'),
      ),
      expected: [true, false, false, false],
    });
  });
});
