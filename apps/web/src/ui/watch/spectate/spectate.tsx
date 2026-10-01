import Link from 'next/link';
import type { SpectateView } from '../../../features/watch/spectate-view';
import { watchRoutes, liveHref } from '../../../features/watch/routes';
import {
  spectateHref,
  type SpectatePane,
} from '../../../features/watch/spectate-query';
import { Badge } from '../../components/badge/badge';
import { Icon } from '../../components/icon/icon';
import { StatusLine } from '../../components/status-line/status-line';
import { cn } from '../../cn';
import { CopyLink } from '../copy-link/copy-link';
import { ActionLink } from '../action-link/action-link';
import { Chat, Reactions } from '../spectator-social/spectator-social';
import { Matchup } from './matchup';
import { PhaseTimeline } from './phase-timeline';
import { ReportDialog } from './report-dialog';
import { SpeechList } from './speech-list';
import { PaneTabs } from '../pane-tabs/pane-tabs';
import { paneClass } from './spectate-class';

export type SpectateProps = {
  readonly view: SpectateView;
};

const panes: readonly { id: SpectatePane; label: string }[] = [
  { id: 'speeches', label: 'Speeches' },
  { id: 'chat', label: 'Chat' },
  { id: 'about', label: 'About' },
];

const strip =
  'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 shadow-1';

function Banners({ view }: SpectateProps) {
  const { banner } = view;
  return (
    <>
      {view.connection === 'reconnecting' ? (
        <div role="status" className={strip}>
          <span className="text-base text-ink-muted">
            <b className="text-ink">Connection lost. Reconnecting.</b> Your
            place in the room is kept. The clock and speeches catch up when you
            are back.
          </span>
          <ActionLink href={liveHref(view.id)}>Try now</ActionLink>
        </div>
      ) : null}
      {banner?.kind === 'pending' ? (
        <div role="status" className={strip}>
          <span className="text-base text-ink-muted">
            <b className="text-ink">This debate has ended.</b> Judges are
            finishing their ballots. The result appears here once every ballot
            is in, so nobody sees a partial count.
          </span>
          <ActionLink href={banner.replayHref}>Open the recording</ActionLink>
        </div>
      ) : null}
      {banner?.kind === 'result' ? (
        <div role="status" className={strip}>
          <div className="flex flex-col gap-1">
            <span className="font-display text-xl font-bold text-ink">
              {banner.headline}
            </span>
            <span className="text-sm text-ink-muted">{banner.detail}</span>
          </div>
          <ActionLink href={banner.replayHref} variant="primary">
            Watch the replay
          </ActionLink>
        </div>
      ) : null}
    </>
  );
}

/**
 * The live view of a debate, live or just ended: seats and clock, phase
 * timeline, reactions, speeches and chat. Everything here is sample state
 * except the running clock; chat and reactions are inert.
 */
export function Spectate({ view }: SpectateProps) {
  const active = view.query.pane;
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-4 px-6 pt-5 pb-8 max-compact:px-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 text-sm text-ink-muted"
        >
          <Link href={watchRoutes.hub} className="font-strong">
            Watch
          </Link>
          <span aria-hidden="true">/</span>
          <span>{view.live ? 'Live debate' : 'Debate'}</span>
        </nav>
        <div className="flex items-center gap-2">
          <CopyLink path={liveHref(view.id)} />
          <Link
            href={spectateHref(view.id, {
              ...view.query,
              report: { kind: 'debate' },
            })}
            className="flex min-h-10 items-center px-3 text-base font-strong text-ink-muted"
          >
            Report
          </Link>
          <Link
            href={watchRoutes.hub}
            className="flex min-h-10 items-center px-3 text-base font-strong text-ink-muted"
          >
            Leave
          </Link>
        </div>
      </div>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          {view.live ? (
            <StatusLine tone="live">Live</StatusLine>
          ) : (
            <Badge>Ended</Badge>
          )}
          <span className="font-strong text-accent">{view.badges.mode}</span>
          <span aria-hidden="true">·</span>
          <span>{view.badges.rules}</span>
          <span aria-hidden="true">·</span>
          <span className="flex items-center gap-1">
            <Icon name="globe" size={14} />
            {view.badges.visibility}
          </span>
          {view.badges.watching === null ? null : (
            <span className="flex items-center gap-1 tabular-nums">
              <Icon name="eye" size={14} />
              {`${view.badges.watching} watching`}
            </span>
          )}
        </div>
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          {view.title}
        </h1>
        <p className="text-base text-ink-muted">{view.subtitle}</p>
      </header>
      <p className="flex items-start gap-2 rounded-md bg-surface-overlay p-3 text-sm text-ink-muted">
        <Icon name="clock" size={16} className="mt-1 shrink-0" />
        {`You are about ${view.about.delaySeconds} seconds behind the debate, so nothing you post can reach a debater. Chat and reactions are for spectators only. Debaters and judges see reactions after the debate ends, and never see chat. Ratings shown are the debaters' ratings for this season.`}
      </p>
      <Banners view={view} />
      <div className="flex items-start gap-6 max-compact:flex-col">
        <div className="flex min-w-0 flex-1 flex-col gap-4 max-compact:w-full">
          <Matchup view={view} />
          <PhaseTimeline timeline={view.timeline} />
          <PaneTabs
            panes={panes.map((pane) => ({
              ...pane,
              href: spectateHref(view.id, {
                ...view.query,
                pane: pane.id,
                report: null,
              }),
              active: active === pane.id,
            }))}
          />
          <div
            className={cn('flex flex-col gap-4', paneClass('speeches', active))}
          >
            <Reactions
              reactions={view.social.reactions}
              open={view.social.open}
            />
            <SpeechList speeches={view.speeches} live={view.live} />
          </div>
          <section
            aria-label="About this debate"
            className={cn(
              'flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-base text-ink-muted',
              paneClass('about', active),
            )}
          >
            <p>{`Rules: ${view.about.rules}`}</p>
            <p>{`Season ${view.about.season}`}</p>
            <p>{`Delay ${view.about.delaySeconds} s`}</p>
            <p>
              Anyone with an account can watch a public debate. Private debates
              never appear here.
            </p>
          </section>
        </div>
        <Chat
          id={view.id}
          query={view.query}
          social={view.social}
          open={view.social.open}
          className={cn(
            'w-rail shrink-0 max-compact:w-full',
            paneClass('chat', active),
          )}
        />
      </div>
      {view.query.report !== null && view.reportTarget !== null ? (
        <ReportDialog
          id={view.id}
          query={view.query}
          target={view.reportTarget}
        />
      ) : null}
      {view.reportSent ? (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-50 rounded-md bg-surface-raised p-4 text-base text-ink shadow-3"
        >
          Report sent. Moderators will review it.
        </div>
      ) : null}
    </div>
  );
}
