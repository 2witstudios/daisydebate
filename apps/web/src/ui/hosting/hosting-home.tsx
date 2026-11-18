import type { ReactNode } from 'react';
import type { HostedTournamentsView } from '@daisy/protocol/lobby/hosting-read';
import type { TimelineRail } from '../../features/tab/tournament';
import {
  entriesOfCap,
  hostingTierWords,
} from '../../features/hosting-purchases/hosting-words';
import { buttonClass } from '../components/button/button-class';
import { PageHeader } from '../components/page-header/page-header';
import { HostShell } from '../tab/host-shell/host-shell';
import { ListCard, ListHeading, ListRow } from '../tab/list-card/list-card';
import { cn } from '../cn';

const linkButton = (variant: 'primary' | 'secondary' | 'ghost') =>
  cn(buttonClass(variant), 'min-h-room-target py-0 text-sm');

/**
 * Host home (PHostHome, decision 80): the tournaments a person hosts, and
 * the start panel where anyone makes one. League is sales-led (S9).
 */
export function HostingHome({
  rail,
  hosted,
  open,
  newHref,
  closeHref,
  addressOf,
  createForm,
}: {
  readonly rail: TimelineRail;
  readonly hosted: HostedTournamentsView;
  /** Whether the start panel is open. */
  readonly open: boolean;
  readonly newHref: string;
  readonly closeHref: string;
  readonly addressOf: (handle: string) => string;
  readonly createForm: ReactNode;
}) {
  return (
    <HostShell rail={rail} current={null}>
      <PageHeader
        title="Your tournaments"
        actions={
          open ? null : (
            <a href={newHref} className={linkButton('primary')}>
              New tournament or league
            </a>
          )
        }
      />
      {open ? (
        <section
          aria-labelledby="host-start"
          className="flex flex-col gap-4 rounded-xl bg-surface p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="host-start" className="font-display text-2xl font-bold">
                What are you running?
              </h2>
              <p className="text-ink-muted">
                Every event and league has a style. Free hosting takes up to 16
                entries.
              </p>
            </div>
            <a href={closeHref} className={linkButton('ghost')}>
              Close
            </a>
          </div>
          <div className="flex gap-4 max-compact:flex-col">
            {createForm}
            <section className="flex min-w-0 flex-1 flex-col gap-4 rounded-lg border border-border bg-surface-raised p-6">
              <div className="flex flex-col gap-1">
                <h3 className="text-xs font-heavy tracking-wider text-ink-muted uppercase">
                  League
                </h3>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-2xl font-bold">A league</p>
                  <span className="font-strong">Talk to us</span>
                </div>
                <p className="text-ink-muted">
                  Many schools across seasons: sanctioned tournaments, season
                  standings and its own ladder.
                </p>
              </div>
              <p className="mt-auto text-sm text-ink-muted">Coming soon</p>
            </section>
          </div>
        </section>
      ) : null}
      <ListCard>
        <ListHeading>Coming up</ListHeading>
        {hosted.tournaments.length === 0 ? (
          <p className="px-4 py-3 text-ink-muted">
            No tournaments yet. Start one: it is free up to 16 entries.
          </p>
        ) : (
          <ul>
            {hosted.tournaments.map((tournament) => (
              <ListRow
                key={tournament.handle}
                title={tournament.name}
                facts="· hosted by you"
                detail={`Freestyle · ${tournament.division === 'youth' ? 'Youth' : 'Open'} · ${hostingTierWords[tournament.tier]} · ${entriesOfCap(tournament.acceptedEntries, tournament.entryCap)}`}
                trailing={
                  <a
                    href={addressOf(tournament.handle)}
                    className={linkButton('secondary')}
                    aria-label={`Open: ${tournament.name}`}
                  >
                    Open
                  </a>
                }
              />
            ))}
          </ul>
        )}
      </ListCard>
    </HostShell>
  );
}
