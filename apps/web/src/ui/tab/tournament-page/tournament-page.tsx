import Link from 'next/link';
import type {
  Keepsakes,
  TournamentPage as Read,
  TournamentPanel,
} from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { TabLinks } from '../../components/tab-links/tab-links';
import { ActionButton, ActionLink } from '../action-control/action-control';
import { Bracket } from '../bracket/bracket';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';
import { StandingsTable } from '../standings/standings-table';
import { PinnedRoom } from './pinned-room';

type Before = Extract<Read, { kind: 'before' }>;
type Rounds = Extract<Read, { kind: 'rounds' }>;
type Adult = Extract<Read, { kind: 'adult' }>;
type After = Extract<Read, { kind: 'after' }>;

const backToTournaments = (
  <Link
    href="/tournaments"
    className="self-start font-strong text-ink underline"
  >
    Tournaments
  </Link>
);

function BeforeTournament({ page }: { readonly page: Before }) {
  return (
    <>
      {backToTournaments}
      <PageHeader title={page.name} lede={page.lede} />
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
        <div className="flex flex-col">
          <strong className="text-md font-strong">{page.places}</strong>
          <span className="text-sm text-ink-muted">{page.closes}</span>
        </div>
        <ActionButton action={page.enter} />
      </section>
      <ListCard>
        <ul>
          {page.terms.map((term) => (
            <ListRow key={term.title} title={term.title} detail={term.detail} />
          ))}
        </ul>
      </ListCard>
      {page.entered === null ? null : (
        <section className="flex flex-col gap-1">
          <h2 className="text-xs font-heavy tracking-wider text-ink-muted uppercase">
            Entered so far
          </h2>
          <p>{page.entered}</p>
        </section>
      )}
    </>
  );
}

function Panel({ panel }: { readonly panel: TournamentPanel }) {
  switch (panel.kind) {
    case 'closed':
      return (
        <p className="rounded-lg border border-border bg-surface-raised px-4 py-6 text-center font-strong">
          {panel.title}
        </p>
      );
    case 'standings':
      return <StandingsTable table={panel.table} />;
    case 'bracket':
      return <Bracket bracket={panel.bracket} />;
    case 'posting':
      return (
        <ListCard>
          <ListHeading>{panel.heading}</ListHeading>
          <ul>
            {panel.rows.map((row) => (
              <ListRow
                key={`${row.title} ${row.detail}`}
                title={row.title}
                detail={row.detail}
                trailing={
                  row.action === null ? null : (
                    <ActionButton action={row.action} about={row.title} />
                  )
                }
              />
            ))}
            {panel.more === 0 ? null : (
              <li className="px-4 py-3 text-sm text-ink-muted">
                {panel.more} more rooms
              </li>
            )}
          </ul>
        </ListCard>
      );
    case 'day':
      return (
        <ListCard>
          {panel.groups.map((group) => (
            <section key={group.heading}>
              <ListHeading>{group.heading}</ListHeading>
              <ul>
                {group.rows.map((row) => (
                  <li
                    key={row.title}
                    className="flex gap-4 border-b border-border px-4 py-3 last:border-b-0"
                  >
                    <span className="tabular-nums">{row.time}</span>
                    <div className="flex min-w-0 flex-col">
                      {row.href === null ? (
                        <strong className="font-strong">{row.title}</strong>
                      ) : (
                        <Link
                          href={row.href}
                          className="font-strong text-ink underline"
                        >
                          {row.title}
                        </Link>
                      )}
                      <span className="text-sm text-ink-muted">
                        {row.detail}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </ListCard>
      );
  }
}

function RoundsTournament({ page }: { readonly page: Rounds }) {
  return (
    <>
      <PageHeader
        title={page.name}
        lede={page.lede}
        actions={
          page.headerAction === null ? undefined : (
            <ActionLink action={page.headerAction} />
          )
        }
      />
      {page.yourRoom === null ? null : <PinnedRoom room={page.yourRoom} />}
      <TabLinks label={page.name} tabs={page.tabs} />
      <Panel panel={page.panel} />
      {page.note === null ? null : (
        <p className="text-sm text-ink-muted">
          {page.note}{' '}
          {page.noteAction === null ? null : (
            <ActionLink action={page.noteAction} />
          )}
        </p>
      )}
      {page.signIn === null ? null : <ActionButton action={page.signIn} />}
    </>
  );
}

function AdultTournament({ page }: { readonly page: Adult }) {
  return (
    <>
      <PageHeader title={page.name} lede={page.lede} />
      <ListCard>
        <ListHeading>Right now</ListHeading>
        <ul>
          {page.now.map((entry) => (
            <ListRow
              key={entry.name}
              title={entry.name}
              facts={entry.facts}
              detail={entry.detail}
              trailing={
                <ActionButton action={entry.action} about={entry.name} />
              }
            />
          ))}
        </ul>
      </ListCard>
      <ListCard>
        <ListHeading>Ballots you can read</ListHeading>
        <ul>
          {page.ballots.map((ballot) => (
            <ListRow
              key={ballot.title}
              title={ballot.title}
              detail={ballot.detail}
              trailing={
                <ActionLink action={ballot.action} about={ballot.title} />
              }
            />
          ))}
        </ul>
        <p className="border-t border-border px-4 py-3 text-sm text-ink-muted">
          {page.ballotsNote}
        </p>
      </ListCard>
      {page.judging === null ? null : (
        <PinnedRoom room={page.judging} label="Your judging" />
      )}
      <ActionLink action={page.manage} className="self-start" />
    </>
  );
}

function Kept({
  heading,
  kept,
}: {
  readonly heading: string;
  readonly kept: Keepsakes;
}) {
  return (
    <section className="border-b border-border last:border-b-0">
      <ListHeading>{heading}</ListHeading>
      <ul>
        {kept.rows.map((row) => (
          <ListRow
            key={row.title}
            title={row.title}
            detail={row.detail}
            trailing={<ActionLink action={row.action} about={row.title} />}
          />
        ))}
        <li className="px-4 py-3">
          <ActionLink action={kept.more} about={heading} />
        </li>
      </ul>
    </section>
  );
}

function AfterTournament({ page }: { readonly page: After }) {
  return (
    <>
      <PageHeader title={page.name} lede={page.lede} />
      <PinnedRoom room={page.result} label="Your result" />
      <ListCard>
        <Kept heading="Your ballots" kept={page.ballots} />
        <Kept heading="Recordings you can watch" kept={page.recordings} />
      </ListCard>
      <p className="text-sm text-ink-muted">{page.recordingsNote}</p>
    </>
  );
}

function screenOf(page: Read) {
  switch (page.kind) {
    case 'before':
      return <BeforeTournament page={page} />;
    case 'rounds':
      return <RoundsTournament page={page} />;
    case 'adult':
      return <AdultTournament page={page} />;
    case 'after':
      return <AfterTournament page={page} />;
  }
}

/**
 * The participant side's tournament page: before entries close, while rounds
 * run and after it has finished, with the viewer's own Room or result pinned;
 * and a responsible adult's view of their entries.
 */
export function TournamentPage({ page }: { readonly page: Read }) {
  return <ReadingPage>{screenOf(page)}</ReadingPage>;
}
