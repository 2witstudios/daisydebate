import { helpTopicHref } from '../../features/help/topics';
import type { AudienceLinks } from '../../features/marketing/links';
import {
  Action,
  AudiencePage,
  Closing,
  Picture,
  Story,
  TextLink,
} from './frame';

const leagues = [
  {
    name: 'Daisy',
    lobbies: [
      ['Open', 'Adults'],
      ['Youth', 'Under 18'],
    ],
  },
  {
    name: 'Your league',
    lobbies: [
      ['High school', 'Under 18'],
      ['Alumni', 'Adults'],
    ],
  },
] as const;

function Trees() {
  return (
    <Picture caption="Daisy runs its own lobbies, one for adults and one for students under 18, the way your league would run its own.">
      <div className="grid grid-cols-2 gap-4 max-compact:grid-cols-1">
        {leagues.map((league) => (
          <div
            key={league.name}
            className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5"
          >
            <span className="font-display text-xl font-semibold">
              {league.name}
            </span>
            <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 max-narrow:grid-cols-1">
              {league.lobbies.map(([name, rule]) => (
                <li
                  key={name}
                  className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised p-4"
                >
                  <span className="font-strong">{name}</span>
                  <span className="text-sm text-ink-muted">
                    {rule} · Ladder · Season · Tournaments
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Picture>
  );
}

/**
 * /leagues: for a league director. Daisy is itself a league with standing
 * lobbies (ADR 0162); another league gets the same shape. The page says who
 * sets a league up: Daisy does, with the league, and the people it names run it
 * from there.
 */
export function LeaguesPage({ links }: { readonly links: AudienceLinks }) {
  return (
    <AudiencePage
      title="Run your league’s season on Daisy"
      lede="Your own lobbies, ladder, seasons and tournaments, on the site where debaters already practise."
      actions={<Action href={links.league}>Talk to us</Action>}
    >
      <Trees />

      <Story id="shape" title="A league like ours">
        <p>
          Daisy runs as a league: an Open lobby for adults and a Youth lobby for
          students under 18, each with its own ladder and season. Your league
          gets the same shape, under its own name.
        </p>
      </Story>

      <Story id="age" title="Each lobby has an age rule">
        <p>
          Adults, under 18, or anyone. A lobby’s tournaments follow its rule, so
          nobody checks entries by hand.
        </p>
      </Story>

      <Story id="seasons" title="Seasons and ratings">
        <p>
          Each lobby runs one season at a time. League ladders run on Freestyle,
          Daisy’s rated format, and ratings use Glicko-2, the system chess sites
          use.{' '}
          <TextLink href={helpTopicHref('ratings')}>How rating works</TextLink>
        </p>
      </Story>

      <Story id="tab" title="Tournaments built in">
        <p>
          Daisy Tab pairs each round, collects the ballots and keeps the
          standings, and the tournaments your league runs are covered.{' '}
          <TextLink href={links.tab}>Daisy Tab</TextLink>
        </p>
      </Story>

      <Story id="setup" title="We set it up with you">
        <p>
          Tell us your league’s name, how many schools, how many seasons a year
          and what you need. We reply within two working days and set your
          league up with you. From there the people you name run its lobbies,
          ladders, seasons and tournaments from the league’s host area.
        </p>
      </Story>

      <Closing id="cost" title="What it costs">
        <p className="max-w-reading text-base leading-normal text-ink-muted">
          League plans are priced with you.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Action href={links.league}>Talk to us</Action>
          <TextLink href={links.pricing}>Plans and pricing</TextLink>
        </div>
      </Closing>
    </AudiencePage>
  );
}
