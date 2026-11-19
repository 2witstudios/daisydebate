import type { PlanActions } from '../../features/pricing/plan-actions';
import type { PlanPrices } from '../../features/pricing/plan-prices';
import {
  eventUpgradeText,
  formatUsd,
  monthlyPeriodText,
  perSeatPeriodText,
} from '../../features/pricing/price-text';
import { PageHeader } from '../components/page-header/page-header';
import { FreeAlways } from './free-always';
import { HostTiers } from './host-tiers';
import { PlanCard } from './plan-card';
import { PricingFaq, type PricingQuestion } from './pricing-faq';

const freeAlways = [
  'Debate other people, casual and ranked',
  'AI judging on every ranked Round',
  'Tournaments, ballots and results',
  'Watch live and public Recordings',
  'One bot Round with its AI judge, and one analysis, to try them',
];

/** The family answer points at Start a Club, so it waits for Club to open. */
const questionsFor = (
  prices: PlanPrices,
  actions: PlanActions,
): readonly PricingQuestion[] => [
  {
    question: 'What does unlimited mean?',
    answer:
      'Use Premium as much as you debate. There are no counters. A fair-use ceiling stops scripts and abuse; nobody debating for real will reach it.',
  },
  {
    question: 'Who plays ranked?',
    answer:
      'Ranked is for members 18 and over; members under 18 play ranked in the Youth lobby. Members are 13 or older. Anyone can judge.',
  },
  ...(actions.club.kind === 'link'
    ? [
        {
          question: 'Can I buy Premium for my children?',
          answer:
            'Yes. Start a Club for your family and give each child a seat. You pay, and you can move a seat when they need it.',
        },
      ]
    : []),
  {
    question: 'Can I cancel any time?',
    answer:
      'Yes. Cancel in Settings. Premium stays on until the end of the month you paid for, and your Recordings and analysis stay yours.',
  },
  {
    question: 'How does Host pricing work?',
    answer: `Every tournament starts free, up to ${prices.host.freeEntryLimit} entries. Upgrade one event when it needs more entries or video: ${prices.host.eventUpgrades.map(eventUpgradeText).join(', ')}. Nothing renews.`,
  },
];

/**
 * /pricing: the four plans side by side (one column on a phone), what is
 * free for everyone, and the questions people ask before paying. Every
 * amount comes from `prices`; each plan's action from `actions`.
 */
export function PricingPage({
  prices,
  actions,
}: {
  readonly prices: PlanPrices;
  readonly actions: PlanActions;
}) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <PageHeader
        title="Plans and pricing"
        lede="Debating people is free. Pay for AI, video and running events."
      />
      <div className="grid grid-cols-4 items-stretch gap-4 max-wide:grid-cols-2 max-narrow:grid-cols-1">
        <PlanCard
          featured
          audience="For one debater"
          name="Premium"
          price={formatUsd(prices.premiumMonthlyCents)}
          period={monthlyPeriodText}
          summary="Practise as much as you want, with feedback on every Round."
          features={[
            'Unlimited bot Rounds',
            'Unlimited AI judging on casual Rounds',
            'Analysis whenever you ask',
            'Record and broadcast your casual Rounds',
            'Download Recordings you can watch',
          ]}
          action={actions.premium}
        />
        <PlanCard
          audience="Coaches, schools, families"
          name="Club"
          price={formatUsd(prices.clubSeatMonthlyCents)}
          period={perSeatPeriodText}
          summary="Premium for every student you seat. The club pays; seats move between students."
          features={[
            'Everything in Premium, for each seat',
            'Add or move seats any time',
            'One bill for the club',
            'Parents: a Club works for your family',
          ]}
          action={actions.club}
        />
        <PlanCard
          audience="Run a tournament"
          name="Host"
          price="Free"
          period="to start"
          summary="Pay per event only when you need more entries or video."
          features={[
            'Recording on paid events',
            'Pairing, ballots and results on every event',
          ]}
          action={actions.host}
        >
          <HostTiers host={prices.host} />
        </PlanCard>
        <PlanCard
          audience="Many schools, whole seasons"
          name="League"
          price="Talk to us"
          summary="We set up your league with you: seasons, schools, divisions and rules."
          features={[
            'Every league tournament covered',
            'Divisions for every age',
            'Sanctioning and season standings',
            'Help moving from your current tab system',
          ]}
          action={actions.league}
        />
      </div>
      <FreeAlways items={freeAlways} />
      <PricingFaq questions={questionsFor(prices, actions)} />
      <p className="text-sm text-ink-muted">
        Prices in US dollars. Taxes may apply where you live.
      </p>
    </div>
  );
}
