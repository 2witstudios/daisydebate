import type { AudienceLinks } from '../../features/marketing/links';
import type { PlanPrices } from '../../features/pricing/plan-prices';
import {
  formatUsd,
  monthlyPeriodText,
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

/** An example of what the Youth lobby lists; the names are illustrations. */
const exampleRooms = [
  ['Ranked Freestyle', 'Live', 'Watch'],
  ['Team Policy scrimmage', 'Live', 'Watch'],
  ['Thursday practice', 'Starting', 'Watch'],
  ['Anyone for Freestyle?', 'Open', 'Join'],
  ['First-timers welcome', 'Open', 'Join'],
] as const;

function Lobby() {
  return (
    <Picture caption="An example of the Youth lobby: every open room and live round on one page. Take a seat, or watch a round to see how other students argue.">
      <div
        aria-hidden="true"
        className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface"
      >
        <span className="px-5 py-4 font-display text-xl font-semibold">
          Youth lobby
        </span>
        {exampleRooms.map(([name, status, action]) => (
          <div
            key={name}
            className="flex items-center justify-between gap-4 border-t border-border px-5 py-3"
          >
            <span className="font-strong">{name}</span>
            <span className="flex items-center gap-4 text-sm text-ink-muted">
              {status}
              <span className="rounded-sm border border-border-strong px-3 py-1 font-strong text-ink">
                {action}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Picture>
  );
}

/**
 * /parents: for a parent. What debate gives a teenager, what Daisy is, and
 * how a parent signs a child up and keeps a say.
 */
export function ParentsPage({
  prices,
  links,
}: {
  readonly prices: PlanPrices;
  readonly links: AudienceLinks;
}) {
  return (
    <AudiencePage
      title="Introduce your kid to debate"
      lede="Debate teaches teenagers to research, reason and speak up, and they learn it alongside kids who love the same thing. On Daisy they can start from home."
      actions={<Action href={links.addChild}>Sign up your child</Action>}
    >
      <Story id="what" title="What Daisy Debate is">
        <p>
          An online arena for competitive debate: one big lobby where students
          find each other, debate, and watch and learn from each other’s rounds.
          Two students meet on live video for a real round: a resolution, timed
          speeches, cross-examination and a judge who picks a winner. They can
          practise in their own league’s format, compete on Daisy’s ranked
          ladder, and judge other students’ rounds.
        </p>
      </Story>

      <Lobby />

      <Story
        id="any-time"
        title="Debate whenever you have time, not only on tournament weekends"
      >
        <p>
          A tournament means a drive to a venue and a whole weekend, so most
          students debate only a few times a season. Daisy adds the weeks in
          between: a round from home whenever your family has time, against
          students from other towns and clubs.
        </p>
      </Story>

      <Story id="feedback" title="Feedback they can use">
        <p>
          A judged round comes back with a ballot: who won, why, and a score for
          each part of the case. Ranked rounds are judged free. With Premium, an
          AI judge can score a practice round the moment it ends, so they never
          wait for a judge, and the rounds they host can be recorded, so you can
          watch one back together and see what to work on next.
        </p>
      </Story>

      <Story id="guardrails" title="You set the guardrails">
        <p>
          Daisy is for everyone 13 and up, adults included. Students under 18
          debate in their own Youth lobby. Link your account to theirs and
          decide which new friends they add, who can message them, whether they
          play ranked, and what happens to their recordings. Give them more
          freedom as they’re ready.
        </p>
      </Story>

      <Story id="community" title="A community to grow in">
        <p>
          Round by round they find their people: students who argue as hard as
          they do, and shake hands after. When they’re ready to compete, the
          Youth ladder is there: ranked rounds against students their age, and a
          rating that grows with them.
        </p>
      </Story>

      <Closing id="start" title="Two minutes to sign them up">
        <p className="max-w-reading text-base leading-normal text-ink-muted">
          Enter their first name, birth month and email. Daisy emails them a
          link, they pick a username, and your settings apply from their first
          round. Already on Daisy? Link their account instead, and they confirm
          it’s you.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Action href={links.addChild}>Sign up your child</Action>
          <span className="text-sm text-ink-muted">
            Debating is free. Premium is {formatUsd(prices.premiumMonthlyCents)}{' '}
            {monthlyPeriodText}.{' '}
            <TextLink href={links.pricing}>Plans and pricing</TextLink>
          </span>
        </div>
        <BetaLine />
      </Closing>
    </AudiencePage>
  );
}
