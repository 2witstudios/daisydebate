import type { AudienceLinks } from '../../features/marketing/links';
import type { PlanPrices } from '../../features/pricing/plan-prices';
import {
  formatUsd,
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

/** The club size the page prices as its example. */
const exampleSeats = 12;

function BallotCard({
  groups,
  categoryCount,
}: {
  readonly groups: readonly {
    readonly name: string;
    readonly categories: readonly string[];
  }[];
  readonly categoryCount: number;
}) {
  return (
    <Picture
      caption={`A Daisy ballot: a decision, the reason for it, and each side scored 1 to 5 in ${categoryCount} categories.`}
    >
      <dl className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-surface-raised p-5 max-narrow:grid-cols-1">
        {groups.map((group) => (
          <div key={group.name} className="flex flex-col gap-1">
            <dt className="font-display text-lg font-semibold">{group.name}</dt>
            <dd className="m-0 text-sm text-ink-muted">
              {group.categories.join(', ')}
            </dd>
          </div>
        ))}
      </dl>
    </Picture>
  );
}

/**
 * /coach: for a coach or club. More rounds than the schedule allows, a
 * ballot from the real rubric, and one plan for the club. What a coach can
 * see of students' rounds is said exactly: it exists for a school club's
 * under-18 students, and live it carries no video (ADR 0155).
 */
export function CoachPage({
  prices,
  links,
  seatLimit,
  ballot,
}: {
  readonly prices: PlanPrices;
  readonly links: AudienceLinks;
  readonly seatLimit: number;
  readonly ballot: {
    readonly groups: readonly {
      readonly name: string;
      readonly categories: readonly string[];
    }[];
    readonly categoryCount: number;
  };
}) {
  const seat = formatUsd(prices.clubSeatMonthlyCents);
  return (
    <AudiencePage
      title="Give your club more rounds than your schedule allows"
      lede="Your students debate each other, or students from other clubs, whenever they have time. Every seat is Premium, so their rounds can be judged and recorded for you to review together."
      actions={<Action href={links.startClub}>Start a Club</Action>}
    >
      <Story id="what" title="What Daisy Debate is">
        <p>
          An online arena for competitive debate: one big lobby where debaters
          find opponents, meet on live video for a real round, and watch each
          other’s rounds. Your league’s format runs here beside Daisy’s ranked
          ladder. Adults and students under 18 debate in separate lobbies.
        </p>
      </Story>

      <BallotCard groups={ballot.groups} categoryCount={ballot.categoryCount} />

      <Story id="between" title="Practice between meetings and tournaments">
        <p>
          Your students don’t have to wait for the next club meeting or
          tournament weekend to get a round in. They can debate each other, or
          take on students from other clubs in the lobby, in the format they
          compete in.
        </p>
      </Story>

      <Story id="review" title="A ballot and a recording to review">
        <p>
          Every club seat comes with Premium. An AI judge can score the practice
          rounds a student hosts the moment each one ends, and those rounds can
          be recorded: a student can open theirs with you, ballot beside it, and
          go through it speech by speech. You, parents and alumni can judge from
          home too.
        </p>
        <p>
          In a school Club, coaches can also follow their under-18 students’
          Youth rounds as they happen, with the clock, speaking order and
          transcript, and open the recordings afterwards.
        </p>
      </Story>

      <Story id="plan" title="One plan for the whole club">
        <p>
          {seat} {perSeatPeriodText}, from 1 to {seatLimit} seats, on one bill.
          A club of {exampleSeats} is{' '}
          {formatUsd(prices.clubSeatMonthlyCents * exampleSeats)} a month.
          Invite students by email and move a seat when someone leaves. Parents
          keep their own say over their kids’ accounts; you run the team.
        </p>
      </Story>

      <Story id="more" title="When your club wants more">
        <p>
          Students who want to compete between tournaments can climb Daisy’s
          ranked ladder.
          {links.tab === null
            ? null
            : ` And you can host your own tournament with Daisy Tab, free up to ${prices.host.freeEntryLimit} entries.`}{' '}
          <TextLink href={links.tab}>Daisy Tab</TextLink>
        </p>
      </Story>

      <Closing id="start" title="Start your club">
        <div className="flex flex-wrap items-center gap-4">
          <Action href={links.startClub}>Start a Club</Action>
          <TextLink href={links.pricing}>Plans and pricing</TextLink>
        </div>
        <BetaLine />
      </Closing>
    </AudiencePage>
  );
}
