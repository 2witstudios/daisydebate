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
import { ActionLink } from '../action-link/action-link';
import {
  ChatComposer,
  ChatMessages,
  Reactions,
} from '../spectator-social/spectator-social';
import { Matchup } from './matchup';
import { PhaseTimeline } from './phase-timeline';
import { ReportDialog } from './report-dialog';
import { SpeechList } from './speech-list';
import { PaneTabs } from '../pane-tabs/pane-tabs';
import { SpectateStage } from './spectate-stage';

export type SpectateProps = {
  readonly view: SpectateView;
};

const panes: readonly { id: SpectatePane; label: string }[] = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'chat', label: 'Chat' },
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
            <b className="text-ink">Connection lost. Reconnecting.</b>
          </span>
          <ActionLink href={liveHref(view.id)}>Try now</ActionLink>
        </div>
      ) : null}
      {banner?.kind === 'pending' ? (
        <div role="status" className={strip}>
          <span className="text-base text-ink-muted">
            <b className="text-ink">This debate has ended.</b>
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

/** Breadcrumb, title, status and audience; Report and Leave on the right. */
function Header({ view }: SpectateProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
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
        <h1 className="font-display text-2xl leading-tight font-bold tracking-tight">
          {view.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          {view.live ? (
            <>
              <StatusLine tone="live">Live</StatusLine>
              <span className="flex items-center gap-1">
                <Icon name="clock" size={14} />
                {`Delayed ${view.delaySeconds} s`}
              </span>
            </>
          ) : (
            <Badge>Ended</Badge>
          )}
          {view.badges.watching === null ? null : (
            <span className="flex items-center gap-1 tabular-nums">
              <Icon name="eye" size={14} />
              {`${view.badges.watching} watching`}
            </span>
          )}
          <span aria-hidden="true">·</span>
          <span className="font-strong text-accent">{view.badges.mode}</span>
          <span aria-hidden="true">·</span>
          <span>{view.badges.rules}</span>
          <span aria-hidden="true">·</span>
          <span className="flex items-center gap-1">
            <Icon name="globe" size={14} />
            {view.badges.visibility}
          </span>
        </div>
      </div>
      <div className="flex items-center">
        <Link
          href={spectateHref(view.id, {
            ...view.query,
            report: { kind: 'debate' },
          })}
          className="flex min-h-room-target items-center px-3 text-base font-strong text-ink-muted"
        >
          Report
        </Link>
        <Link
          href={watchRoutes.hub}
          className="flex min-h-room-target items-center px-3 text-base font-strong text-ink-muted"
        >
          Leave
        </Link>
      </div>
    </header>
  );
}

/** Transcript or chat, chosen by `?pane=`, over the chat composer. */
function LiveColumn({ view }: SpectateProps) {
  const active = view.query.pane;
  return (
    <aside
      aria-label="Live"
      className="flex w-watch-live shrink-0 flex-col border-l border-border bg-surface max-compact:w-full max-compact:border-t max-compact:border-l-0 compact:sticky compact:top-0 compact:h-dvh"
    >
      <PaneTabs
        label="Live"
        phoneOnly={false}
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
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {active === 'transcript' ? (
          <SpeechList speeches={view.speeches} live={view.live} />
        ) : (
          <>
            <Reactions
              reactions={view.social.reactions}
              open={view.social.open}
            />
            <ChatMessages
              id={view.id}
              query={view.query}
              messages={view.social.messages}
              open={view.social.open}
            />
          </>
        )}
      </div>
      <ChatComposer chatRules={view.social.chatRules} open={view.social.open} />
    </aside>
  );
}

/**
 * The spectator view of a debate, live or just ended: the speaker large with
 * the other debater inset, the phase timeline and the seats, beside the
 * transcript and chat. Everything here is sample state except the running
 * clock; chat and reactions are inert.
 */
export function Spectate({ view }: SpectateProps) {
  return (
    <div className="flex min-h-full max-compact:flex-col">
      <div className="flex min-w-0 flex-1 flex-col gap-3 px-5 py-4 max-narrow:px-3">
        <Header view={view} />
        <Banners view={view} />
        <SpectateStage view={view} />
        <PhaseTimeline timeline={view.timeline} />
        <Matchup view={view} />
      </div>
      <LiveColumn view={view} />
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
          Report sent
        </div>
      ) : null}
    </div>
  );
}
