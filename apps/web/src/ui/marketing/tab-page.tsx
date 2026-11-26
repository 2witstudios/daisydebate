import type { AudienceLinks } from '../../features/marketing/links';
import type { PlanPrices } from '../../features/pricing/plan-prices';
import { entryLimitText, formatUsd } from '../../features/pricing/price-text';
import {
  Action,
  AudiencePage,
  Closing,
  Picture,
  Story,
  TextLink,
} from './frame';

const steps = [
  ['Pair', 'Power-matched, random or round robin, then publish the round.'],
  ['Debate', 'Each debate gets its own room on Daisy: video, clock and judge.'],
  ['Ballots', 'Judges submit on Daisy, from a laptop or a phone.'],
  ['Standings', 'Results update the standings and seed the break.'],
] as const;

function RoundFlow() {
  return (
    <Picture caption="One round of a tournament, start to finish.">
      <ol className="m-0 grid list-none grid-cols-4 gap-4 p-0 max-wide:grid-cols-2 max-narrow:grid-cols-1">
        {steps.map(([name, body], index) => (
          <li
            key={name}
            className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5"
          >
            <span
              aria-hidden="true"
              className="font-display text-2xl font-semibold text-ink-faint"
            >
              {index + 1}
            </span>
            <span className="font-display text-lg font-semibold">{name}</span>
            <span className="text-sm text-ink-muted">{body}</span>
          </li>
        ))}
      </ol>
    </Picture>
  );
}

/**
 * /tab: for a tournament director. What Daisy Tab does in one round, where
 * a tournament can happen, and the hosting tiers, each amount read from
 * `prices` (ADR 0149).
 */
export function TabPage({
  prices,
  links,
}: {
  readonly prices: PlanPrices;
  readonly links: AudienceLinks;
}) {
  const [first, last] = prices.host.eventUpgrades;
  return (
    <AudiencePage
      title="Tab your tournament on Daisy"
      lede={`Daisy Tab pairs each round, collects every ballot and keeps the standings. Free up to ${prices.host.freeEntryLimit} entries.`}
      actions={<Action href={links.host}>Host a tournament</Action>}
    >
      <Story id="what" title="What Daisy Tab is">
        <p>
          Tournament software built into Daisy. Create your tournament and its
          events, pair each round, and let judges submit their ballots on Daisy.
          Standings come from the results, and an elimination stage can follow
          the preliminary rounds.
        </p>
      </Story>

      <RoundFlow />

      <Story id="where" title="Online, or in one building">
        <p>
          Online, every debate has its own room on Daisy, so there is no venue
          to book and nobody has to travel. If your debaters are in one
          building, post each round’s pairings from Daisy and let judges ballot
          from their phones.
        </p>
      </Story>

      <Story id="release" title="You decide what is released, and when">
        <p>
          Open each round’s pairings, decisions, scores and reasons to debaters
          and to the audience when you are ready. Certify the event when the
          results are final.
        </p>
      </Story>

      <Closing id="cost" title="What it costs">
        <dl className="grid grid-cols-3 gap-4 max-compact:grid-cols-1">
          <div className="flex flex-col gap-1">
            <dt className="font-display text-xl font-semibold">Free</dt>
            <dd className="m-0 text-sm text-ink-muted">
              {entryLimitText(prices.host.freeEntryLimit)}. Pairings, ballots
              and results. No recording.
            </dd>
          </div>
          {prices.host.eventUpgrades.map((upgrade) => (
            <div key={upgrade.cents} className="flex flex-col gap-1">
              <dt className="font-display text-xl font-semibold">
                {formatUsd(upgrade.cents)}
              </dt>
              <dd className="m-0 text-sm text-ink-muted">
                {entryLimitText(upgrade.entryLimit)}. Online rounds can be
                recorded.
              </dd>
            </div>
          ))}
        </dl>
        <p className="max-w-reading text-sm text-ink-muted">
          Paid once per tournament; nothing renews.
          {first && last && first !== last
            ? ` Moving from ${formatUsd(first.cents)} to ${formatUsd(last.cents)} costs the ${formatUsd(last.cents - first.cents)} difference.`
            : null}{' '}
          A league plan covers all of its league’s tournaments.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Action href={links.host}>Host a tournament</Action>
          <TextLink href={links.pricing}>Plans and pricing</TextLink>
        </div>
      </Closing>
    </AudiencePage>
  );
}
