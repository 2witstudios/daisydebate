import Link from 'next/link';
import { premiumOfferPrice } from '../../features/billing/premium-price';
import { buttonClass } from '../components/button/button-class';
import { PageHeader } from '../components/page-header/page-header';
import { Panel } from '../components/panel/panel';
import { ReadingPage } from '../components/reading-page/reading-page';

const primary = `${buttonClass('primary')} min-h-nav-target w-full whitespace-nowrap narrow:w-auto`;
const secondary = `${buttonClass('secondary')} min-h-nav-target self-start whitespace-nowrap`;

/**
 * Premium pays for AI and capture while human play and official results stay
 * open. Premium is unlimited: no counters, only an unseen fair-use ceiling
 * (ADR 0146). Buying happens on the billing page, which holds checkout.
 */
export function PremiumPage({
  comparePlans = false,
}: {
  /** Whether /pricing is open, so "Compare plans" has somewhere to go. */
  readonly comparePlans?: boolean;
} = {}) {
  return (
    <ReadingPage>
      <PageHeader
        title="Daisy Premium"
        lede="More ways to practise, review and share your debates."
        actions={
          comparePlans ? (
            <Link href="/pricing" className={secondary}>
              Compare plans
            </Link>
          ) : undefined
        }
      />
      <Panel
        title={`Premium · ${premiumOfferPrice}`}
        action={
          <Link href="/settings/billing" className={buttonClass('ghost')}>
            Billing
          </Link>
        }
      >
        <div className="flex flex-col gap-4">
          <ul className="flex list-disc flex-col gap-3 pl-5">
            <li>Unlimited bot Rounds.</li>
            <li>Unlimited casual AI judging.</li>
            <li>Round analysis whenever you ask.</li>
            <li>Host casual recording and broadcast.</li>
            <li>Download Recordings you are authorized to watch.</li>
          </ul>
          <p className="text-sm text-ink-muted">
            No counters to watch. A fair-use ceiling stops scripts and abuse;
            nobody debating for real will reach it.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/settings/billing" className={primary}>
              Get Premium · {premiumOfferPrice}
            </Link>
          </div>
        </div>
      </Panel>
      <Panel title="Human debate stays free">
        <div className="flex flex-col gap-3">
          <p>
            Play against other people for free. Ranked AI judging and access to
            existing ballots stay free under their normal permissions.
          </p>
          <p>
            Each free account can try one bot Round, one AI-judged casual Round
            and one requested Round analysis, ever.
          </p>
          <Link href="/play" className={secondary}>
            Play a debate
          </Link>
        </div>
      </Panel>
      <Panel title="Your debates stay yours">
        <div className="flex flex-col gap-3">
          <p>
            Premium renews monthly. Cancel any time; Premium stays on through
            the end of the month you paid for.
          </p>
          <p>
            Your delivered analysis stays readable to you after Premium ends,
            while its content is retained. Existing Recordings remain watchable
            under their visibility rules. Premium does not change who can access
            private content.
          </p>
        </div>
      </Panel>
    </ReadingPage>
  );
}
