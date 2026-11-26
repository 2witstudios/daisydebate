import type { AudienceLinks } from '../../features/marketing/links';
import type { FormatTimes } from '../../features/marketing/ncfca-times';
import type { PlanPrices } from '../../features/pricing/plan-prices';
import {
  formatUsd,
  monthlyPeriodText,
  perSeatPeriodText,
} from '../../features/pricing/price-text';
import {
  Action,
  AudiencePage,
  BetaLine,
  Closing,
  Picture,
  Story,
  TextLink,
} from './frame';

/** A season drawn as weeks: a few tournament weekends, and the weeks between. */
const seasonWeeks = 26;
const tournamentWeeks = new Set([5, 11, 17, 23]);

function Season() {
  return (
    <Picture caption="A season: a few tournament weekends, and the weeks in between, when practice happens on Daisy.">
      <div
        aria-hidden="true"
        className="flex h-12 items-end gap-1 rounded-xl border border-border bg-surface p-4"
      >
        {Array.from({ length: seasonWeeks }, (_, week) => (
          <span
            key={week}
            className={
              tournamentWeeks.has(week)
                ? 'h-full flex-1 rounded-sm bg-gold'
                : 'h-1/2 flex-1 rounded-sm bg-accent'
            }
          />
        ))}
      </div>
    </Picture>
  );
}

/**
 * /ncfca: for an NCFCA family. Practice between tournaments, in NCFCA's own
 * speaking order and times (read from the format catalog), with a ballot
 * back. NCFCA is named only to say whose published rules the rounds follow.
 */
export function NcfcaPage({
  times,
  categoryCount,
  prices,
  links,
}: {
  readonly times: readonly FormatTimes[];
  /** How many categories the current ballot scores. */
  readonly categoryCount: number;
  readonly prices: PlanPrices;
  readonly links: AudienceLinks;
}) {
  const premium = `${formatUsd(prices.premiumMonthlyCents)} ${monthlyPeriodText}`;
  const seat = `${formatUsd(prices.clubSeatMonthlyCents)} ${perSeatPeriodText}`;
  return (
    <AudiencePage
      title="Practice rounds between NCFCA tournaments"
      lede="Your student debates a real opponent from home, whenever your family has time, in Lincoln-Douglas or Team Policy, and gets a written ballot back."
      actions={
        <>
          <Action href={links.addChild}>Sign up your student</Action>
          <Action
            href={links.signIn}
            variant={links.addChild === null ? 'primary' : 'secondary'}
          >
            I’m a student, 13 or older
          </Action>
        </>
      }
    >
      <Season />

      <Story id="same-round" title="The same round they compete in">
        <p>
          Daisy runs NCFCA’s published speaking order and times, on live video,
          with the clock kept for both sides.
        </p>
        <dl className="flex flex-col gap-2 text-sm">
          {times.map((format) => (
            <div key={format.name}>
              <dt className="font-strong text-ink">{format.name}</dt>
              <dd className="m-0 tabular-nums">
                {format.speeches}. Prep {format.prepMinutes} minutes a side.
              </dd>
            </div>
          ))}
        </dl>
      </Story>

      <Story id="opponents" title="A real opponent, any week">
        <p>
          Their clubmates, or students from other clubs who are in the lobby
          when they are. Team Policy partners each join from their own home.
        </p>
      </Story>

      <Story id="ballot" title="A ballot they can use">
        <p>
          You, another parent or an alumnus can judge from wherever you are, and
          the ballot comes back with a decision, the reason for it, and scores
          in {categoryCount} categories for each side.
          {links.premiumOpen
            ? ' With Premium, an AI judge can score the practice rounds your student hosts, the moment each one ends.'
            : null}
        </p>
      </Story>

      {links.premiumOpen ? (
        <Story id="watch-back" title="Watch it back together">
          <p>
            With Premium, the practice rounds your student hosts can be
            recorded. Watch one back with the ballot beside it and see what to
            work on before the next tournament.
          </p>
        </Story>
      ) : null}

      <Story id="guardrails" title="A lobby for students under 18">
        <p>
          Members are 13 or older. Students under 18 debate in the Youth lobby,
          with other students under 18.
          {links.addChild === null
            ? null
            : ' Link your account to theirs to approve new friends, limit who can message them, and follow their rounds as they happen.'}{' '}
          <TextLink href={links.parents}>Daisy for parents</TextLink>
        </p>
      </Story>

      <Story id="practice" title="Practice, not points">
        <p>
          NCFCA rounds on Daisy are practice. They do not count toward NCFCA
          standings. For competition between tournaments there is Freestyle,
          Daisy’s ranked format, with a ladder of its own for students under 18.
        </p>
      </Story>

      <Closing id="cost" title="What it costs">
        <p className="max-w-reading text-base leading-normal text-ink-muted">
          Debating other people is free.
          {links.premiumOpen
            ? ` Premium is ${premium}: recording and AI ballots on the practice rounds your student hosts, and Round analysis.`
            : null}
          {links.premiumOpen && links.startClub !== null
            ? ` For several children, a family Club is ${seat}, and every seat is Premium.`
            : null}{' '}
          <TextLink href={links.pricing}>Plans and pricing</TextLink>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Action href={links.addChild ?? links.signIn}>
            {links.addChild === null ? 'Sign up' : 'Sign up your student'}
          </Action>
          <TextLink href={links.coach}>Daisy for coaches and clubs</TextLink>
        </div>
        <BetaLine />
      </Closing>

      <p className="max-w-reading text-sm text-ink-muted">
        Daisy Debate is not affiliated with, endorsed by or sponsored by NCFCA.
        The name is used only to say which published rules these practice rounds
        follow.
      </p>
    </AudiencePage>
  );
}
