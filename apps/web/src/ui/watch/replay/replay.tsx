import Link from 'next/link';
import type { ReplayView } from '../../../features/watch/replay-build';
import {
  replayQueryHref,
  type ReplayPane,
} from '../../../features/watch/replay-query';
import { watchRoutes } from '../../../features/watch/routes';
import { Badge } from '../../components/badge/badge';
import { cn } from '../../cn';
import { InertButton } from '../inert-button/inert-button';
import { PaneTabs } from '../pane-tabs/pane-tabs';
import { DetailsPanel } from './details-panel';
import { Player } from './player';
import { replayPaneClass } from './replay-class';
import { ResultPanel } from './result-panel';
import { SharePanel } from './share-panel';
import { Timeline } from './timeline';
import { Transcript } from './transcript';

export type ReplayProps = {
  readonly view: ReplayView;
};

const panes: readonly { id: ReplayPane; label: string }[] = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'result', label: 'Result' },
  { id: 'share', label: 'Share' },
];

/**
 * The replay of a recorded debate: player, timeline and transcript beside the
 * result, the sharing and visibility manager, and the details. Position,
 * search, pane and the open manager all live in the URL.
 */
export function Replay({ view }: ReplayProps) {
  const active = view.query.pane;
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-4 px-6 pt-5 pb-8 max-compact:px-4">
      <div className="flex items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
          <Link href={watchRoutes.recordings} className="font-strong">
            Recordings
          </Link>
        </nav>
        <InertButton action="report" variant="ghost">
          Report
        </InertButton>
      </div>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-strong text-accent">
            {view.badges.mode}
          </span>
          <span className="text-sm text-ink-muted">{view.badges.rules}</span>
          <Badge>{view.badges.visibility}</Badge>
        </div>
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          {view.title}
        </h1>
        <p className="text-base text-ink-muted">{view.subtitle}</p>
      </header>
      <div className="flex items-start gap-6 max-compact:flex-col">
        <div className="flex min-w-0 flex-1 flex-col gap-4 max-compact:w-full">
          <Player view={view} />
          <Timeline timeline={view.timeline} density={view.density} />
          <PaneTabs
            panes={panes.map((pane) => ({
              ...pane,
              href: replayQueryHref(view.id, { ...view.query, pane: pane.id }),
              active: active === pane.id,
            }))}
          />
          <div className={replayPaneClass('transcript', active)}>
            <Transcript
              id={view.id}
              query={view.query}
              transcript={view.transcript}
            />
          </div>
        </div>
        <div className="flex basis-1/3 flex-col gap-4 max-compact:w-full max-compact:basis-auto">
          <div className={replayPaneClass('result', active)}>
            <ResultPanel result={view.result} />
          </div>
          <div
            className={cn(
              'flex flex-col gap-4',
              replayPaneClass('share', active),
            )}
          >
            <SharePanel id={view.id} query={view.query} share={view.share} />
            <DetailsPanel rows={view.details} />
          </div>
        </div>
      </div>
    </div>
  );
}
